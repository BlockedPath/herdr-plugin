export function findCollisions(candidateId, marketplaceData) {
	if (!candidateId || typeof candidateId !== "string") return [];
	if (!marketplaceData || !Array.isArray(marketplaceData.plugins)) return [];
	const normalized = candidateId.trim();
	const collisions = [];
	for (const repo of marketplaceData.plugins) {
		if (!repo || !Array.isArray(repo.manifests)) continue;
		for (const manifest of repo.manifests) {
			if (manifest?.id === normalized) {
				collisions.push({
					fullName:
						repo.fullName ??
						`${repo.owner ?? "unknown"}/${repo.name ?? "unknown"}`,
					manifest,
					repo,
				});
			}
		}
	}
	// Deduplicate by fullName
	const seen = new Set();
	return collisions.filter((c) => {
		if (seen.has(c.fullName)) return false;
		seen.add(c.fullName);
		return true;
	});
}

export function hasCollision(candidateId, candidateFullName, marketplaceData) {
	const collisions = findCollisions(candidateId, marketplaceData);
	if (collisions.length === 0) return false;
	if (collisions.length > 1) return true;
	// Single entry: collision only if it's not the candidate's own repo
	if (!candidateFullName) return true; // unknown candidate repo → treat as collision
	return collisions[0].fullName !== candidateFullName;
}
