#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const HERDR_BIN = process.env.HERDR_BIN_PATH ?? "herdr";

function runHerdr(args) {
	return new Promise((resolve, reject) => {
		const child = spawn(HERDR_BIN, args, { shell: false });
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (err += d));
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve(out)
				: reject(new Error(err || `herdr ${args.join(" ")} exited ${code}`)),
		);
	});
}

async function listPanes() {
	const raw = await runHerdr(["pane", "list"]);
	try {
		const doc = JSON.parse(raw);
		return doc.result?.panes ?? [];
	} catch {
		return [];
	}
}

async function readPane(paneId, lines = 40) {
	try {
		const out = await runHerdr([
			"pane",
			"read",
			paneId,
			"--lines",
			String(lines),
			"--format",
			"text",
		]);
		return out.trim().split("\n").slice(-lines);
	} catch {
		return [];
	}
}

function isErrorLine(line) {
	return /(error|fail|exception|panic|fatal|warn)/i.test(line);
}

const panes = await listPanes();
const workspaceId =
	process.env.HERDR_WORKSPACE_ID ??
	panes.find((p) => p.focused)?.workspace_id ??
	panes[0]?.workspace_id;
const filtered = workspaceId
	? panes.filter((p) => p.workspace_id === workspaceId)
	: panes;

if (filtered.length === 0) {
	process.stdout.write("Log Tail — no panes in this workspace\n[q] quit\n");
	process.exit(0);
}

const allLines = [];
for (const pane of filtered) {
	const lines = await readPane(pane.pane_id, 30);
	for (const line of lines) {
		if (!line.trim()) continue;
		allLines.push({
			pane: pane.pane_id,
			title: pane.terminal_title_stripped ?? pane.pane_id,
			line,
		});
	}
}

// sort errors first, filterable
let filter = "";
function render() {
	console.clear();
	process.stdout.write(
		`Log Tail — ${filtered.length} panes in ${workspaceId ?? "workspace"}  [filter: ${filter || "none"}]\n`,
	);
	process.stdout.write(
		`[q] quit  [f] focus pane  [e] errors only  [c] clear filter  Type to filter\n\n`,
	);
	const view = filter
		? allLines.filter(
				(e) =>
					e.line.toLowerCase().includes(filter.toLowerCase()) ||
					e.pane.toLowerCase().includes(filter.toLowerCase()),
			)
		: allLines;
	const errorsOnly = filter === "__errors__";
	const display = errorsOnly
		? allLines.filter((e) => isErrorLine(e.line))
		: view;
	const slice = display.slice(-80);
	for (const entry of slice) {
		const flag = isErrorLine(entry.line) ? "!" : " ";
		const truncated = entry.line.slice(0, 110);
		process.stdout.write(
			`${flag} ${entry.pane} [${entry.title.slice(0, 16)}] ${truncated}\n`,
		);
	}
	if (slice.length === 0) process.stdout.write("(no matching lines)\n");
}

render();

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", async (line) => {
	const v = line.trim();
	if (v === "q") {
		rl.close();
		process.exit(0);
	}
	if (v === "c") {
		filter = "";
		render();
		return;
	}
	if (v === "e") {
		filter = "__errors__";
		render();
		return;
	}
	if (v.startsWith("f ")) {
		const paneId = v.slice(2).trim();
		if (paneId) {
			try {
				await runHerdr(["pane", "focus", paneId]);
				process.stdout.write(`\nFocused ${paneId}\n`);
			} catch (e) {
				process.stdout.write(
					`\nFocus failed: ${e instanceof Error ? e.message : String(e)}\n`,
				);
			}
		}
		render();
		return;
	}
	if (v) {
		filter = v;
		render();
	}
});

process.on("SIGINT", () => {
	rl.close();
	process.exit(0);
});
