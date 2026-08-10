#!/usr/bin/env node
import { createInterface } from "node:readline";
import { auditSource, auditInstalled } from "../audit/audit.mjs";
import { compareInstalled } from "../compare/compare.mjs";
import { renderTerminal } from "../render/terminal.mjs";
import { getMarketplace } from "../marketplace/index.mjs";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function question(prompt) {
	return new Promise((resolve) => rl.question(prompt, resolve));
}

function clearTemp() {
	// Popup holds no durable temp files; any per-run temp is in OS tmp and cleaned by audit
}

process.on("SIGINT", () => {
	clearTemp();
	rl.close();
	process.exit(0);
});

const modeEnv = process.env.HERDR_XRAY_MODE;
const sourceEnv = process.env.HERDR_XRAY_SOURCE;

let mode = modeEnv === "installed" ? "installed" : "choose";
let source = sourceEnv ?? null;

if (mode === "choose") {
	const choice = await question(
		"X-Ray: [1] Audit GitHub/local  [2] Audit installed  [3] Compare  [q] Quit > ",
	);
	if (choice.trim() === "1") {
		source = await question(
			"Enter source (owner/repo, https://github.com/owner/repo, or ./local/path) > ",
		);
		mode = "audit";
	} else if (choice.trim() === "2") {
		const pluginId = await question("Installed plugin ID > ");
		try {
			const receipt = await auditInstalled(pluginId.trim());
			process.stdout.write(renderTerminal(receipt));
			process.stdout.write(
				`\nCommit-pinned install: herdr plugin install ${receipt.subject.source.owner ?? "owner"}/${receipt.subject.source.repo ?? "repo"} --ref ${receipt.subject.source.resolvedCommit ?? "<commit>"}\n`,
			);
		} catch (error) {
			process.stderr.write(
				`audit failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
		clearTemp();
		rl.close();
		process.exit(0);
	} else if (choice.trim() === "3") {
		const pluginId = await question("Installed plugin ID > ");
		const candidate = await question("Candidate source > ");
		try {
			const receipt = await compareInstalled(pluginId.trim(), candidate.trim());
			process.stdout.write(renderTerminal(receipt));
		} catch (error) {
			process.stderr.write(
				`compare failed: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
		clearTemp();
		rl.close();
		process.exit(0);
	} else {
		clearTemp();
		rl.close();
		process.exit(0);
	}
}

if (source) {
	// Validate source is repository-root-like or local path; treat as data, never as shell
	const trimmed = source.trim();
	try {
		const receipt = await auditSource(trimmed);
		process.stdout.write(renderTerminal(receipt));
		process.stdout.write(
			`\nCommit-pinned install: herdr plugin install ${receipt.subject.source.owner ?? "owner"}/${receipt.subject.source.repo ?? "repo"} --ref ${receipt.subject.source.resolvedCommit ?? "<commit>"}\n`,
		);
		// Best-effort marketplace collision note (offline-safe)
		try {
			const data = await getMarketplace({ offline: false });
			const { findCollisions } = await import("../marketplace/collisions.mjs");
			const collisions = findCollisions(receipt.subject.plugin.id, data);
			if (collisions.length > 1) {
				process.stdout.write(
					`\nMarketplace collision: ${receipt.subject.plugin.id} claimed by ${collisions.map((c) => c.fullName).join(", ")}\n`,
				);
			}
		} catch {}
	} catch (error) {
		process.stderr.write(
			`audit failed: ${error instanceof Error ? error.message : String(error)}\n`,
		);
	}
}

clearTemp();
rl.close();
