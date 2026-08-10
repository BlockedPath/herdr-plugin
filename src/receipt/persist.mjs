import { mkdir, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

function stateDir() {
	if (process.env.HERDR_PLUGIN_STATE_DIR)
		return process.env.HERDR_PLUGIN_STATE_DIR;
	const xdg = process.env.XDG_STATE_HOME;
	if (xdg) return join(xdg, "herdr-xray");
	return join(homedir(), ".local", "state", "herdr-xray");
}

function hashSegment(value) {
	return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

export function receiptPersistPath(receipt, options = {}) {
	const base = options.stateDir ?? stateDir();
	const pluginId = receipt.subject.plugin?.id ?? "unknown";
	const pluginHash = hashSegment(pluginId);
	const receiptHash =
		receipt.receiptHash?.slice(7, 23) ??
		hashSegment(JSON.stringify(receipt)).slice(0, 16);
	return join(base, "receipts", pluginHash, `${receiptHash}.json`);
}

export async function persistReceipt(receipt, options = {}) {
	const dest = receiptPersistPath(receipt, options);
	await mkdir(dirname(dest), { recursive: true });
	const tmp = join(
		dirname(dest),
		`.${basename(dest)}.tmp.${process.pid}-${randomUUID()}`,
	);
	let handle;
	try {
		handle = await open(tmp, "wx", 0o600);
		await handle.writeFile(JSON.stringify(receipt, null, 2), "utf8");
		await handle.sync();
		await handle.close();
		handle = null;
		await rename(tmp, dest);
	} finally {
		await handle?.close();
		await rm(tmp, { force: true });
	}
	return dest;
}
