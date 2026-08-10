#!/usr/bin/env node
import { spawn } from "node:child_process";

const HERDR_BIN = process.env.HERDR_BIN_PATH ?? "herdr";

function isRepositoryRootUrl(value) {
	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.hostname !== "github.com" ||
			url.username ||
			url.password ||
			url.port ||
			url.search ||
			url.hash
		)
			return false;
		const segments = url.pathname.split("/").filter(Boolean);
		if (segments.length !== 2) return false;
		segments[1] = segments[1].replace(/\.git$/i, "");
		if (!segments[0] || !segments[1]) return false;
		if (
			!/^[A-Za-z0-9_.-]+$/.test(segments[0]) ||
			!/^[A-Za-z0-9_.-]+$/.test(segments[1])
		)
			return false;
		return true;
	} catch {
		return false;
	}
}

async function openPopup(env = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			HERDR_BIN,
			[
				"plugin",
				"pane",
				"open",
				"--plugin",
				"blockedpath.xray",
				"--entrypoint",
				"xray",
				...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
			],
			{
				shell: false,
				stdio: "inherit",
				windowsHide: true,
			},
		);
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`herdr pane open exited with ${code}`)),
		);
	});
}

const args = process.argv.slice(2);
const installed = args.includes("--installed");
const clicked = process.env.HERDR_PLUGIN_CLICKED_URL;

if (clicked) {
	if (!isRepositoryRootUrl(clicked)) {
		console.error(`herdr-xray: ignoring non-repository GitHub URL: ${clicked}`);
		process.exit(0);
	}
	// Pass validated URL as source via env; popup will treat it as data, never as shell syntax
	await openPopup({ HERDR_XRAY_SOURCE: clicked });
} else if (installed) {
	await openPopup({ HERDR_XRAY_MODE: "installed" });
} else {
	await openPopup({});
}
