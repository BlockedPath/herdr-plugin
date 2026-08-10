import { lstat, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

import { auditInstalled, auditSource } from "../audit/audit.mjs";
import { compareInstalled } from "../compare/compare.mjs";
import { HARD_LIMITS } from "../config/limits.mjs";
import { getMarketplace } from "../marketplace/index.mjs";
import { ReceiptVerifyError, verifyReceipt } from "../receipt/verify.mjs";
import { renderJson } from "../render/json.mjs";
import { renderMarkdown } from "../render/markdown.mjs";
import { renderTerminal } from "../render/terminal.mjs";
import { EXIT, HELP, VERSION_TEXT } from "./contract.mjs";

const BOOLEAN_OPTIONS = new Set([
	"--offline",
	"--fail-on-unknown",
	"--require-complete",
	"--no-color",
]);
const VALUE_OPTIONS = new Set([
	"--ref",
	"--format",
	"--output",
	"--marketplace-check",
	"--redaction",
	"--fail-on-severity",
	"--max-files",
	"--max-total-bytes",
	"--max-file-bytes",
	"--max-depth",
	"--timeout-ms",
]);

export async function main(argv, io = {}) {
	const stdout = io.stdout ?? process.stdout;
	const stderr = io.stderr ?? process.stderr;
	const [command] = argv;
	if (argv.length === 0) {
		stdout.write(HELP);
		return EXIT.OK;
	}
	if (command === "help" || command === "--help" || command === "-h") {
		return writeSingleton(argv, stdout, stderr, HELP);
	}
	if (command === "version" || command === "--version" || command === "-V") {
		return writeSingleton(argv, stdout, stderr, VERSION_TEXT);
	}
	if (argv.slice(1).includes("--help")) {
		stdout.write(HELP);
		return EXIT.OK;
	}
	if (command === "receipt") {
		if (argv.length !== 3 || argv[1] !== "verify" || argv[2].startsWith("-")) {
			return usageError(stderr, "receipt requires: receipt verify <path>");
		}
		try {
			await verifyReceipt(argv[2], { cwd: io.cwd, limits: io.limits });
			stdout.write(`receipt verify: ${argv[2]} is valid\n`);
			return EXIT.OK;
		} catch (error) {
			if (error instanceof ReceiptVerifyError) {
				stderr.write(`herdr-xray: receipt verify failed: ${error.message}\n`);
				return EXIT.RECEIPT_INVALID;
			}
			const message = error instanceof Error ? error.message : String(error);
			stderr.write(`herdr-xray: receipt verify failed: ${message}\n`);
			return EXIT.INCOMPLETE;
		}
	}

	const positionalCounts = {
		audit: 1,
		"audit-installed": 1,
		compare: 2,
		"marketplace-collisions": 0,
	};
	if (!Object.hasOwn(positionalCounts, command)) {
		return usageError(stderr, `unknown command: ${command}`);
	}
	const parsed = parseCommonArguments(argv.slice(1), positionalCounts[command]);
	if (parsed.error !== null) return usageError(stderr, parsed.error);
	if (command === "marketplace-collisions") {
		try {
			const marketplaceData = await getMarketplace({
				fetch: io.fetch,
				signal: io.signal,
				limits: parsed.options.limits,
				offline: parsed.options.offline === true,
			});
			const collisions = findDuplicateIds(marketplaceData);
			const format = parsed.options.format ?? "terminal";
			const output = renderCollisions(collisions, format);
			if (parsed.options.output === undefined) stdout.write(output);
			else await writeAtomic(parsed.options.output, output, io.cwd);
			return EXIT.OK;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			stderr.write(`herdr-xray: marketplace-collisions failed: ${message}\n`);
			return EXIT.INCOMPLETE;
		}
	}
	if (
		command !== "audit" &&
		command !== "audit-installed" &&
		command !== "compare"
	) {
		return notImplemented(stderr, command);
	}
	if (command === "audit-installed" && parsed.options.ref !== undefined) {
		return usageError(stderr, "--ref is valid only for GitHub sources");
	}

	try {
		const auditOptions = {
			cwd: io.cwd,
			fetch: io.fetch,
			ref: parsed.options.ref,
			limits: parsed.options.limits,
			redaction: parsed.options.redaction,
			signal: io.signal,
			spawn: io.spawn,
			env: io.env,
			herdrBinPath: io.herdrBinPath,
			marketplaceCheck: parsed.options.marketplaceCheck ?? "off",
			offline: parsed.options.offline === true,
			persist: true,
		};
		const receipt = await run(command, parsed.positionals, auditOptions);
		if (
			command === "compare" &&
			receipt.completeness.dimensions.comparison.status === "unavailable"
		) {
			stderr.write(
				`herdr-xray: compare failed: ${receipt.completeness.dimensions.comparison.reason}\n`,
			);
			return EXIT.INCOMPLETE;
		}
		const rendered = render(receipt, parsed.options.format ?? "terminal");
		if (parsed.options.output === undefined) stdout.write(rendered);
		else await writeAtomic(parsed.options.output, rendered, io.cwd);
		return policyExit(receipt, parsed.options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr.write(`herdr-xray: ${command} failed: ${message}\n`);
		return EXIT.INCOMPLETE;
	}
}

async function run(command, positionals, options) {
	if (command === "audit-installed") {
		return await auditInstalled(positionals[0], options);
	}
	if (command === "compare") {
		return await compareInstalled(positionals[0], positionals[1], options);
	}
	return await auditSource(positionals[0], options);
}

function render(receipt, format) {
	if (format === "json") return renderJson(receipt);
	if (format === "markdown") return renderMarkdown(receipt);
	return renderTerminal(receipt);
}

function parseCommonArguments(args, expectedPositionals) {
	const positionals = [];
	const rawOptions = new Map();
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (BOOLEAN_OPTIONS.has(argument)) {
			if (rawOptions.has(argument))
				return { error: `duplicate option: ${argument}` };
			rawOptions.set(argument, true);
			continue;
		}
		if (VALUE_OPTIONS.has(argument)) {
			if (rawOptions.has(argument))
				return { error: `duplicate option: ${argument}` };
			const value = args[index + 1];
			if (value === undefined || value.startsWith("-"))
				return { error: `${argument} requires a value` };
			const valueError = validateOptionValue(argument, value);
			if (valueError !== null) return { error: valueError };
			rawOptions.set(argument, value);
			index += 1;
			continue;
		}
		if (argument.startsWith("-"))
			return { error: `unknown option: ${argument}` };
		positionals.push(argument);
	}
	if (positionals.length !== expectedPositionals) {
		return {
			error: `expected ${expectedPositionals} positional argument(s), received ${positionals.length}`,
		};
	}
	return { error: null, positionals, options: normalizedOptions(rawOptions) };
}

function normalizedOptions(raw) {
	const limits = {};
	const mappings = {
		"--max-files": "filesAnalyzed",
		"--max-total-bytes": "totalAnalysisBytes",
		"--max-file-bytes": "singleTextFileBytes",
		"--max-depth": "traceDepth",
		"--timeout-ms": "timeoutMs",
	};
	for (const [option, name] of Object.entries(mappings)) {
		if (raw.has(option)) limits[name] = Number(raw.get(option));
	}
	return {
		ref: raw.get("--ref"),
		format: raw.get("--format"),
		output: raw.get("--output"),
		redaction: raw.get("--redaction") ?? "strict",
		requireComplete: raw.has("--require-complete"),
		failOnUnknown: raw.has("--fail-on-unknown"),
		failOnSeverity: raw.get("--fail-on-severity"),
		marketplaceCheck: raw.get("--marketplace-check"),
		offline: raw.has("--offline") ? true : undefined,
		limits,
	};
}

function validateOptionValue(option, value) {
	const choices = {
		"--format": new Set(["terminal", "json", "markdown"]),
		"--marketplace-check": new Set(["auto", "on", "off"]),
		"--redaction": new Set(["strict", "standard"]),
		"--fail-on-severity": new Set(["low", "medium", "high"]),
	};
	if (Object.hasOwn(choices, option) && !choices[option].has(value))
		return `invalid value for ${option}: ${value}`;
	const numericLimits = {
		"--max-files": HARD_LIMITS.filesAnalyzed,
		"--max-total-bytes": HARD_LIMITS.totalAnalysisBytes,
		"--max-file-bytes": HARD_LIMITS.singleTextFileBytes,
		"--max-depth": HARD_LIMITS.traceDepth,
		"--timeout-ms": HARD_LIMITS.timeoutMs,
	};
	if (Object.hasOwn(numericLimits, option)) {
		if (!/^[1-9][0-9]*$/.test(value))
			return `${option} requires a positive integer`;
		const parsed = Number(value);
		if (!Number.isSafeInteger(parsed) || parsed > numericLimits[option]) {
			return `${option} exceeds its hard maximum of ${numericLimits[option]}`;
		}
	}
	if (option === "--ref" && /^<.*>$/.test(value)) {
		return '--ref looks like a placeholder "<sha>"; use a real branch, tag, or 40-char commit without angle brackets (e.g. --ref main)';
	}
	if (option === "--ref" && (/\p{C}/u.test(value) || value.length > 512)) {
		return "--ref contains control characters or exceeds 512 characters";
	}
	return null;
}

function policyExit(receipt, options) {
	if (options.requireComplete && !receipt.completeness.complete)
		return EXIT.INCOMPLETE;
	if (options.failOnUnknown && receipt.summary.unknowns > 0) return EXIT.POLICY;
	if (options.failOnSeverity !== undefined) {
		const rank = { info: 0, low: 1, medium: 2, high: 3 };
		const threshold = rank[options.failOnSeverity];
		if (receipt.findings.some((finding) => rank[finding.severity] >= threshold))
			return EXIT.POLICY;
	}
	return EXIT.OK;
}

async function writeAtomic(path, content, cwd) {
	const destination = resolve(cwd ?? process.cwd(), path);
	try {
		const existing = await lstat(destination);
		if (!existing.isFile() || existing.isSymbolicLink())
			throw new Error("output target must be a regular file");
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	const temporary = join(
		dirname(destination),
		`.${basename(destination)}.xray-${process.pid}-${randomUUID()}.tmp`,
	);
	let handle;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(content, "utf8");
		await handle.sync();
		await handle.close();
		handle = null;
		await rename(temporary, destination);
	} finally {
		await handle?.close();
		await rm(temporary, { force: true });
	}
}

function writeSingleton(argv, stdout, stderr, text) {
	if (argv.length !== 1)
		return usageError(stderr, `${argv[0]} does not accept arguments`);
	stdout.write(text);
	return EXIT.OK;
}
function usageError(stderr, message) {
	stderr.write(`herdr-xray: ${message}\nRun 'herdr-xray help' for usage.\n`);
	return EXIT.USAGE;
}
function notImplemented(stderr, command) {
	stderr.write(`herdr-xray: ${command} is not implemented\n`);
	return EXIT.INCOMPLETE;
}

function findDuplicateIds(marketplaceData) {
	const byId = new Map();
	for (const repo of marketplaceData.plugins ?? []) {
		for (const manifest of repo.manifests ?? []) {
			if (!manifest?.id) continue;
			const list = byId.get(manifest.id) ?? [];
			list.push(
				repo.fullName ?? `${repo.owner ?? "unknown"}/${repo.name ?? "unknown"}`,
			);
			byId.set(manifest.id, list);
		}
	}
	return [...byId.entries()]
		.filter(([, repos]) => new Set(repos).size > 1)
		.map(([id, repos]) => ({ id, repos: [...new Set(repos)].sort() }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

function renderCollisions(collisions, format) {
	if (format === "json") return `${JSON.stringify({ collisions }, null, 2)}\n`;
	if (collisions.length === 0)
		return "No marketplace plugin ID collisions found.\n";
	const lines = ["Marketplace plugin ID collisions:", ""];
	for (const entry of collisions) {
		if (format === "markdown")
			lines.push(`- \`${entry.id}\`: ${entry.repos.join(", ")}`);
		else lines.push(`- ${entry.id}: ${entry.repos.join(", ")}`);
	}
	return `${lines.join("\n")}\n`;
}
