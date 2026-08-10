#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";

const CREDENTIAL =
	/(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL|AUTH)/i;

function workspaceRoot() {
	return (
		process.env.HERDR_WORKSPACE_ROOT ??
		process.env.HERDR_PANE_CWD ??
		process.cwd()
	);
}

async function findEnvFiles(root) {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		return entries
			.filter((e) => e.isFile() && e.name.startsWith(".env"))
			.map((e) => e.name)
			.sort();
	} catch {
		return [];
	}
}

function parseEnv(text) {
	const map = new Map();
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		const value = line.slice(eq + 1).trim();
		if (!key) continue;
		map.set(key, value);
	}
	return map;
}

function mask(value) {
	if (!value) return "<empty>";
	return "••••••";
}

const root = workspaceRoot();
const files = await findEnvFiles(root);

if (files.length === 0) {
	process.stdout.write(`Env Peek — ${root}\nNo .env* files found.\n`);
	process.exit(0);
}

const envs = new Map();
for (const name of files) {
	try {
		const text = await readFile(join(root, name), "utf8");
		envs.set(name, parseEnv(text));
	} catch {
		envs.set(name, new Map());
	}
}

const example = envs.get(".env.example") ?? envs.get(".env.sample") ?? null;
const primary = envs.get(".env") ?? envs.get(files[0]);

process.stdout.write(`Env Peek — ${root}\nFound: ${files.join(", ")}\n`);
if (example && primary) {
	const missing = [...example.keys()].filter((k) => !primary.has(k));
	const extra = [...primary.keys()].filter((k) => !example.has(k));
	const empty = [...primary.entries()]
		.filter(([, v]) => v === "")
		.map(([k]) => k);
	const credentialMissing = missing.filter((k) => CREDENTIAL.test(k));

	if (missing.length) {
		process.stdout.write(
			`\nMissing in ${primary === envs.get(".env") ? ".env" : files[0]} vs .env.example (${missing.length}):\n`,
		);
		for (const k of missing) {
			const flag = CREDENTIAL.test(k) ? " [credential]" : "";
			process.stdout.write(`  - ${k}${flag}\n`);
		}
	} else {
		process.stdout.write("\nNo missing keys vs .env.example\n");
	}
	if (credentialMissing.length) {
		process.stdout.write(
			`\n⚠ Credential keys missing: ${credentialMissing.join(", ")}\n`,
		);
	}
	if (empty.length) {
		process.stdout.write(
			`\nEmpty values in primary (${empty.length}): ${empty.join(", ")}\n`,
		);
	}
	if (extra.length) {
		process.stdout.write(
			`\nExtra in primary not in example (${extra.length}): ${extra.join(", ")}\n`,
		);
	}
} else {
	process.stdout.write("\nTip: add .env.example to get missing/extra diff\n");
}

process.stdout.write("\nKeys (values masked):\n");
for (const [name, map] of envs) {
	process.stdout.write(`\n${name} (${map.size} keys):\n`);
	for (const [k, v] of map) {
		const tag = CREDENTIAL.test(k) ? " credential" : "";
		process.stdout.write(`  ${k}=${mask(v)}${tag}\n`);
	}
}

process.stdout.write("\n[q] quit  [r] reload\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", (line) => {
	if (line.trim().toLowerCase() === "q") {
		rl.close();
		process.exit(0);
	}
	if (line.trim().toLowerCase() === "r") {
		rl.close();
		process.exit(0);
	}
});
process.on("SIGINT", () => {
	rl.close();
	process.exit(0);
});
