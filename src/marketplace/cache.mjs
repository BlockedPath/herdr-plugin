import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

function stateDir() {
	if (process.env.HERDR_PLUGIN_STATE_DIR)
		return process.env.HERDR_PLUGIN_STATE_DIR;
	const xdg = process.env.XDG_STATE_HOME;
	if (xdg) return join(xdg, "herdr-xray");
	return join(homedir(), ".local", "state", "herdr-xray");
}

export function marketplaceCachePath(options = {}) {
	const base = options.stateDir ?? stateDir();
	return join(base, "marketplace.json");
}

export async function readMarketplaceCache(options = {}) {
	const path = marketplaceCachePath(options);
	try {
		const text = await readFile(path, "utf8");
		const parsed = JSON.parse(text);
		if (
			!parsed ||
			typeof parsed !== "object" ||
			!parsed.data ||
			typeof parsed.fetchedAt !== "string"
		)
			return null;
		return parsed;
	} catch {
		return null;
	}
}

export async function writeMarketplaceCache(data, options = {}) {
	const path = marketplaceCachePath(options);
	const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
	const payload = JSON.stringify(
		{
			fetchedAt: new Date().toISOString(),
			contentHash: `sha256:${hash}`,
			data,
		},
		null,
		2,
	);
	await mkdir(dirname(path), { recursive: true });
	// Atomic write with temp file + rename (no follow needed for cache dir we created)
	const tmp = `${path}.tmp.${process.pid}`;
	await writeFile(tmp, payload, "utf8");
	// Use rename for atomicity
	const { rename } = await import("node:fs/promises");
	await rename(tmp, path);
	return path;
}
