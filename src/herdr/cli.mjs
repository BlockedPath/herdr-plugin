import { spawn as nodeSpawn } from "node:child_process";

import { resolveLimits } from "../config/limits.mjs";

const CONTROL_PATTERN = /\p{C}/u;
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/;
const REQUIRED_PLUGIN_FIELDS = ["plugin_id", "manifest_path", "plugin_root"];

export class HerdrCliError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "HerdrCliError";
		this.code = code;
		this.details = details;
	}
}

export function herdrBinaryPath(env = process.env) {
	const configured = env.HERDR_BIN_PATH;
	if (configured === undefined || configured === "") return "herdr";
	if (typeof configured !== "string" || CONTROL_PATTERN.test(configured)) {
		throw new HerdrCliError(
			"herdr-bin-path-unsafe",
			"HERDR_BIN_PATH contains control characters",
		);
	}
	return configured;
}

export async function listInstalledPlugins(options = {}) {
	const bytes = await runHerdr(["plugin", "list", "--json"], options);
	let document;
	try {
		document = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new HerdrCliError(
			"herdr-invalid-json",
			"herdr plugin list --json did not return valid JSON",
		);
	}
	return parsePluginList(document);
}

export function parsePluginList(document) {
	const result = plainObject(document)?.result;
	const envelope = plainObject(result);
	if (envelope === null || envelope.type !== "plugin_list") {
		throw new HerdrCliError(
			"herdr-unexpected-response",
			"herdr plugin list --json did not return a plugin_list result",
		);
	}
	if (!Array.isArray(envelope.plugins)) {
		throw new HerdrCliError(
			"herdr-unexpected-response",
			"herdr plugin list --json did not return a plugins array",
		);
	}
	return Object.freeze(
		envelope.plugins.map((entry, index) => normalizePlugin(entry, index)),
	);
}

function normalizePlugin(entry, index) {
	const plugin = plainObject(entry);
	if (plugin === null) {
		throw new HerdrCliError(
			"herdr-unexpected-response",
			`installed plugin at index ${index} is not an object`,
		);
	}
	for (const field of REQUIRED_PLUGIN_FIELDS) {
		if (typeof plugin[field] !== "string" || plugin[field].length === 0) {
			throw new HerdrCliError(
				"herdr-incomplete-plugin",
				`installed plugin at index ${index} is missing ${field}`,
				{ field },
			);
		}
	}
	return Object.freeze({
		pluginId: plugin.plugin_id,
		manifestPath: plugin.manifest_path,
		pluginRoot: plugin.plugin_root,
		source: normalizeSource(plainObject(plugin.source)),
	});
}

function normalizeSource(source) {
	if (source === null) return null;
	const resolvedCommit = optionalString(source.resolved_commit);
	return Object.freeze({
		kind: optionalString(source.kind),
		owner: optionalString(source.owner),
		repo: optionalString(source.repo),
		subdir: optionalString(source.subdir),
		requestedRef: optionalString(source.requested_ref),
		resolvedCommit:
			resolvedCommit !== null && COMMIT_PATTERN.test(resolvedCommit)
				? resolvedCommit
				: null,
	});
}

async function runHerdr(argv, options) {
	const limits = resolveLimits(options.limits ?? {});
	const spawn = options.spawn ?? nodeSpawn;
	const binary = options.herdrBinPath ?? herdrBinaryPath(options.env);
	return await new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(binary, argv, {
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch (error) {
			reject(
				new HerdrCliError(
					"herdr-unavailable",
					`could not run ${binary}: ${message(error)}`,
				),
			);
			return;
		}

		const chunks = [];
		let stdoutBytes = 0;
		let stderrText = "";
		let settled = false;

		const timer = setTimeout(() => {
			finish(
				new HerdrCliError(
					"herdr-timeout",
					`herdr did not respond within ${limits.timeoutMs} ms`,
				),
			);
		}, limits.timeoutMs);

		function finish(error, value) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error !== null) {
				try {
					child.kill();
				} catch {
					// The process already exited; nothing to terminate.
				}
				reject(error);
				return;
			}
			resolve(value);
		}

		child.stdout?.on("data", (chunk) => {
			stdoutBytes += chunk.length;
			if (stdoutBytes > limits.herdrResponseBytes) {
				finish(
					new HerdrCliError(
						"herdr-response-too-large",
						`herdr response exceeded ${limits.herdrResponseBytes} bytes`,
					),
				);
				return;
			}
			chunks.push(Buffer.from(chunk));
		});
		child.stderr?.on("data", (chunk) => {
			if (stderrText.length >= limits.diagnosticBytes) return;
			stderrText += Buffer.from(chunk)
				.toString("utf8")
				.slice(0, limits.diagnosticBytes - stderrText.length);
		});
		child.on("error", (error) => {
			finish(
				new HerdrCliError(
					"herdr-unavailable",
					`could not run ${binary}: ${message(error)}`,
				),
			);
		});
		child.on("close", (code) => {
			if (code === 0) {
				finish(null, Buffer.concat(chunks));
				return;
			}
			finish(
				new HerdrCliError(
					"herdr-exit-status",
					`herdr exited with status ${code}${stderrText === "" ? "" : `: ${stderrText.trim()}`}`,
					{ status: code },
				),
			);
		});
	});
}

function plainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value
		: null;
}

function optionalString(value) {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}
