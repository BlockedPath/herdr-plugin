#!/usr/bin/env node
import { spawn } from "node:child_process";

const HERDR_BIN = process.env.HERDR_BIN_PATH ?? "herdr";

await new Promise((resolve, reject) => {
	const child = spawn(HERDR_BIN, ["plugin", "pane", "open", "--plugin", "blockedpath.xray", "--entrypoint", "xray"], {
		shell: false,
		stdio: "inherit",
		windowsHide: true,
	});
	child.on("error", reject);
	child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`herdr pane open exited with ${code}`))));
});
