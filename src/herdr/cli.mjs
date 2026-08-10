import { spawn as nodeSpawn } from "node:child_process";

import { resolveLimits } from "../config/limits.mjs";

const CONTROL_PATTERN = /\p{C}/u;
const COMMIT_PATTERN = /^[0-9a-f]{40,64}$/;
const GITHUB_PART_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/;
const REQUIRED_PLUGIN_FIELDS = ["plugin_id", "manifest_path", "plugin_root"];
const SIGKILL_GRACE_MS = 500;

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
	const owner = matching(source.owner, GITHUB_PART_PATTERN);
	const repo = matching(source.repo, GITHUB_PART_PATTERN);
	const normalized = {
		kind: bounded(source.kind, 64),
		owner,
		repo,
		subdir: subdirectory(source.subdir),
		requestedRef: bounded(source.requested_ref, 512),
		resolvedCommit: matching(source.resolved_commit, COMMIT_PATTERN),
	};
	// Herdr-reported upstream identity is unverified input. Any field that cannot
	// satisfy the published receipt schema is dropped rather than propagated.
	normalized.unverified =
		normalized.kind === "github" &&
		(owner === null || repo === null || normalized.resolvedCommit === null);
	return Object.freeze(normalized);
}

function subdirectory(value) {
	const subdir = bounded(value, 1024);
	if (subdir === null) return null;
	const segments = subdir.split("/");
	return segments.every(
		(segment) =>
			segment !== "." && segment !== ".." && PATH_SEGMENT_PATTERN.test(segment),
	)
		? subdir
		: null;
}

function bounded(value, maxLength) {
	return typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		!CONTROL_PATTERN.test(value)
		? value
		: null;
}

function matching(value, pattern) {
	const text = bounded(value, 1024);
	return text !== null && pattern.test(text) ? text : null;
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

		function release() {
			for (const stream of [child.stdout, child.stderr]) {
				stream?.removeAllListeners?.("data");
				stream?.destroy?.();
			}
			child.unref?.();
		}

		function terminate() {
			send("SIGTERM");
			if (child.exitCode !== null && child.exitCode !== undefined) return;
			// A child that ignores SIGTERM must not outlive its bounded deadline.
			const escalation = setTimeout(() => send("SIGKILL"), SIGKILL_GRACE_MS);
			child.once?.("exit", () => clearTimeout(escalation));
		}

		function send(signal) {
			try {
				child.kill(signal);
			} catch {
				// The process already exited; nothing to terminate.
			}
		}

		function finish(error, value) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error !== null) {
				terminate();
				release();
				reject(error);
				return;
			}
			release();
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
					`herdr exited with status ${code}${stderrText === "" ? "" : `: ${printable(stderrText.trim())}`}`,
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

function printable(value) {
	return value
		.replaceAll(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "")
		.replaceAll(/[\p{Cc}\p{Cf}]/gu, "\uFFFD");
}

function message(error) {
	return error instanceof Error ? error.message : String(error);
}
