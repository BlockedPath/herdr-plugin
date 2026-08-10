import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";

import { listInstalledPlugins } from "../herdr/cli.mjs";

const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MANIFEST_NAME = "herdr-plugin.toml";

export class InstalledSourceError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "InstalledSourceError";
		this.code = code;
		this.details = details;
	}
}

export async function resolveInstalledInput(pluginId, options = {}) {
	validatePluginId(pluginId);
	const plugins = options.plugins ?? (await listInstalledPlugins(options));
	const matches = plugins.filter((entry) => entry.pluginId === pluginId);
	if (matches.length === 0) {
		throw new InstalledSourceError(
			"installed-plugin-not-found",
			`no installed plugin reports plugin_id ${pluginId}`,
		);
	}
	if (matches.length > 1) {
		throw new InstalledSourceError(
			"installed-plugin-ambiguous",
			`herdr reported ${matches.length} installed plugins with plugin_id ${pluginId}`,
		);
	}
	const [record] = matches;
	const root = await resolvePath(
		record.pluginRoot,
		"installed-root-unavailable",
		"installed plugin root",
	);
	const manifest = await resolvePath(
		record.manifestPath,
		"installed-manifest-unavailable",
		"installed plugin manifest",
	);
	const expected = await resolvePath(
		join(root, MANIFEST_NAME),
		"installed-manifest-unavailable",
		`${MANIFEST_NAME} inside the installed plugin root`,
	);
	if (!samePath(manifest, expected)) {
		throw new InstalledSourceError(
			"installed-manifest-outside-root",
			`installed manifest is not ${MANIFEST_NAME} inside the reported plugin root`,
		);
	}
	await refuseLink(join(root, MANIFEST_NAME));
	return Object.freeze({
		kind: "installed",
		pluginId,
		root,
		display: pluginId,
		installed: record.source,
	});
}

function validatePluginId(pluginId) {
	if (
		typeof pluginId !== "string" ||
		pluginId.length === 0 ||
		pluginId.length > 128 ||
		!PLUGIN_ID_PATTERN.test(pluginId)
	) {
		throw new InstalledSourceError(
			"invalid-plugin-id",
			"plugin id must match ^[A-Za-z0-9][A-Za-z0-9._:-]*$ and be at most 128 characters",
		);
	}
}

async function resolvePath(value, code, label) {
	try {
		return await realpath(value);
	} catch (error) {
		throw new InstalledSourceError(
			code,
			`could not resolve ${label}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function refuseLink(path) {
	const metadata = await lstat(path).catch((error) => {
		throw new InstalledSourceError(
			"installed-manifest-unavailable",
			`could not inspect ${MANIFEST_NAME}: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	if (!metadata.isFile()) {
		throw new InstalledSourceError(
			"installed-manifest-not-regular",
			`${MANIFEST_NAME} inside the plugin root is not a regular file`,
		);
	}
}

function samePath(left, right) {
	return process.platform === "win32"
		? left.toLowerCase() === right.toLowerCase()
		: left === right;
}
