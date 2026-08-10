#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

function workspaceRoot() {
	return process.env.HERDR_WORKSPACE_ROOT ?? process.env.HERDR_PANE_CWD ?? process.cwd();
}

function gitLog(root) {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["log", "--oneline", "-20", "--color=never"], { cwd: root, shell: false });
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (err += d));
		child.on("error", reject);
		child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err || `git log exited ${code}`))));
	});
}

function gitShow(root, hash) {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["show", "--stat", hash], { cwd: root, shell: false });
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		child.on("error", reject);
		child.on("close", () => resolve(out));
	});
}

const root = workspaceRoot();
let log = "";
try {
	log = await gitLog(root);
} catch (e) {
	process.stdout.write(`Herdr Mixtape — ${root}\n\nNot a git repo or no commits: ${e instanceof Error ? e.message : String(e)}\n\n[q] quit\n`);
	process.exit(0);
}

const tracks = log.trim().split("\n").filter(Boolean).map((line) => {
	const sp = line.indexOf(" ");
	return { hash: line.slice(0, sp), message: line.slice(sp + 1) };
});

const title = root.split("/").pop() || "herdr";
const date = new Date().toISOString().slice(0, 10);

// ASCII mixtape cover
const cover = [
	"┌──────────────────────────────────────┐",
	`│  HERDR MIXTAPE: ${title.padEnd(22).slice(0, 22)} │`,
	`│  ${date}                     │`,
	`│                                      │`,
	`│   ██████  ██   ██  ██████             │`,
	`│   ██      ██   ██  ██                 │`,
	`│   ██      ███████  █████              │`,
	`│   ██      ██   ██  ██                 │`,
	`│   ██████  ██   ██  ██ Vol.1          │`,
	"└──────────────────────────────────────┘",
];

process.stdout.write(cover.join("\n") + "\n\n");
process.stdout.write(`Side A — ${tracks.slice(0, 10).length} tracks  |  Side B — ${tracks.slice(10).length} tracks\n\n`);
tracks.forEach((t, i) => {
	const side = i < 10 ? "A" : "B";
	const num = i < 10 ? i + 1 : i - 9;
	process.stdout.write(`${side}${num}. ${t.message.slice(0, 60)}  [${t.hash.slice(0, 7)}]\n`);
});
process.stdout.write("\n[Enter number] play (git show)  [c] copy tracklist  [s] save png (Kitty)  [q] quit\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", async (line) => {
	const v = line.trim().toLowerCase();
	if (v === "q") { rl.close(); process.exit(0); }
	if (v === "c") {
		const list = tracks.map((t, i) => `${i + 1}. ${t.message} (${t.hash})`).join("\n");
		process.stdout.write("\n" + list + "\n\n");
		return;
	}
	if (v === "s") {
		process.stdout.write("\n[Kitty graphics PNG sharing not yet implemented — use [c] then screenshot]\n\n");
		return;
	}
	const n = Number.parseInt(v, 10);
	if (!Number.isNaN(n) && n >= 1 && n <= tracks.length) {
		const track = tracks[n - 1];
		const show = await gitShow(root, track.hash);
		process.stdout.write("\n" + show.slice(0, 4000) + "\n\n");
	}
});
process.on("SIGINT", () => { rl.close(); process.exit(0); });
