import { getMarketplace, findCollisions } from "./index.mjs";
import { finalizeReceipt } from "../receipt/hash.mjs";
import { createFinding } from "../rules/finding.mjs";

export async function enrichWithMarketplace(receipt, options = {}) {
	const check = options.marketplaceCheck ?? "auto";
	const offline = options.offline === true;
	if (check === "off") return receipt;

	let marketplaceData = null;
	let dimension = null;
	let collisionFinding = null;

	try {
		if (offline) {
			const { readMarketplaceCache } = await import("./cache.mjs");
			const cached = await readMarketplaceCache(options);
			if (!cached)
				throw new Error("marketplace cache unavailable in offline mode");
			marketplaceData = cached.data;
		} else {
			marketplaceData = await getMarketplace(options);
		}
		const candidateId = receipt.subject.plugin?.id;
		if (candidateId) {
			const collisions = findCollisions(candidateId, marketplaceData);
			// Distinct sources claiming same id (including candidate if it's listed)
			const distinctRepos = new Set(collisions.map((c) => c.fullName));
			const candidateRepo =
				receipt.subject.source?.owner && receipt.subject.source?.repo
					? `${receipt.subject.source.owner}/${receipt.subject.source.repo}`
					: null;
			const otherCollisions = collisions.filter(
				(c) => c.fullName !== candidateRepo,
			);
			if (otherCollisions.length > 0 || distinctRepos.size > 1) {
				const repos = [...distinctRepos].sort().join(", ");
				collisionFinding = createFinding(
					"xray.identity.plugin-id-collision",
					`Plugin ID ${candidateId} is claimed by multiple marketplace sources: ${repos}`,
					`The marketplace lists ${distinctRepos.size} distinct repositories claiming plugin ID ${candidateId}. Verify you trust the expected source before installing.`,
					candidateId,
				);
			}
		}
		dimension = { status: "complete", reason: null, limit: null };
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (check === "on") {
			dimension = { status: "unavailable", reason: msg, limit: null };
		} else {
			// auto: degrade gracefully, mark unavailable but not required
			dimension = { status: "unavailable", reason: msg, limit: null };
		}
	}

	if (!dimension) return receipt;

	// Merge finding and dimension into receipt and recompute hashes
	const findings = collisionFinding
		? [...receipt.findings, collisionFinding].sort((a, b) =>
				a.id.localeCompare(b.id),
			)
		: receipt.findings;
	const dimensions = {
		...receipt.completeness.dimensions,
		marketplace: dimension,
	};
	// Top-level complete stays as before unless check === "on" and marketplace not complete
	const coreComplete =
		Object.entries(dimensions)
			.filter(([k]) => !["marketplace", "comparison"].includes(k))
			.every(([, v]) => v.status === "complete") &&
		!receipt.completeness.unstable;
	let topComplete = receipt.completeness.complete;
	if (check === "on") {
		topComplete = dimensions.marketplace.status === "complete" && coreComplete;
	}
	// Recalculate summary
	const summary = {
		facts: findings.filter((f) => f.class === "fact").length,
		heuristics: findings.filter((f) => f.class === "heuristic").length,
		unknowns: findings.filter((f) => f.class === "unknown").length,
		bySeverity: {
			info: findings.filter((f) => f.severity === "info").length,
			low: findings.filter((f) => f.severity === "low").length,
			medium: findings.filter((f) => f.severity === "medium").length,
			high: findings.filter((f) => f.severity === "high").length,
		},
	};
	const enriched = {
		...receipt,
		findings,
		completeness: {
			...receipt.completeness,
			complete: topComplete,
			dimensions,
		},
		summary,
	};
	return finalizeReceipt(enriched);
}
