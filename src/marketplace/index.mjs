import { fetchMarketplace } from "./fetch.mjs";
import { readMarketplaceCache, writeMarketplaceCache } from "./cache.mjs";

export async function getMarketplace(options = {}) {
	if (options.offline) {
		const cached = await readMarketplaceCache(options);
		if (cached) return cached.data;
		throw new Error("marketplace cache unavailable in offline mode");
	}
	try {
		const data = await fetchMarketplace(options);
		// Best-effort cache write; ignore errors
		try { await writeMarketplaceCache(data, options); } catch {}
		return data;
	} catch (error) {
		const cached = await readMarketplaceCache(options);
		if (cached) return cached.data;
		throw error;
	}
}

export { findCollisions, hasCollision } from "./collisions.mjs";
