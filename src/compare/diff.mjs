const SEVERITY_ORDER = ["info", "low", "medium", "high"];
const SUBJECT_MAX = 1024;

const ADDED_NODE_SEVERITY = Object.freeze({
	trigger: "medium",
	command: "medium",
	"package-lifecycle": "high",
	subprocess: "high",
	"network-endpoint": "high",
	"environment-variable": "medium",
	"filesystem-path": "medium",
	"opaque-binary": "high",
	unknown: "high",
	"source-file": "info",
	plugin: "info",
});

const AUTOMATIC_TRIGGER_LABELS = new Set(["build", "startup"]);

const PLUGIN_FIELDS = Object.freeze([
	["plugin.id", "high", (plugin) => plugin.id],
	["plugin.name", "info", (plugin) => plugin.name],
	["plugin.version", "info", (plugin) => plugin.version],
	["plugin.minHerdrVersion", "low", (plugin) => plugin.minHerdrVersion],
	["plugin.platforms", "medium", (plugin) => plugin.platforms?.join(",")],
]);

const UPSTREAM_FIELDS = Object.freeze([
	["source.owner", "high", (upstream) => upstream.owner],
	["source.repo", "high", (upstream) => upstream.repo],
	["source.subdir", "medium", (upstream) => upstream.subdir],
	["source.resolvedCommit", "info", (upstream) => upstream.commit],
]);

// Acquisition method is not plugin identity: an installed baseline is always
// read from disk while a candidate may be local or remote. Only upstream
// repository identity is comparable, and only when both sides declare it.
export function upstreamIdentity(receipt) {
	const source = receipt.subject.source;
	const owner = source.owner ?? null;
	const repo = source.repo ?? null;
	if (owner === null || repo === null) return null;
	return Object.freeze({
		owner,
		repo,
		subdir: source.subdir ?? null,
		commit: source.resolvedCommit ?? null,
		display: `${owner}/${repo}${source.subdir === null || source.subdir === undefined ? "" : `/${source.subdir}`}`,
	});
}

export function diffReceipts(baseline, candidate, limits) {
	const collected = [
		...identityChanges(baseline, candidate),
		...graphChanges(baseline, candidate),
		...findingChanges(baseline, candidate),
		...completenessChanges(baseline, candidate),
		...fileChanges(baseline, candidate),
	].sort(compareChanges);
	const limit = limits.comparisonChanges;
	const truncated = collected.length > limit;
	return {
		changes: truncated ? collected.slice(0, limit) : collected,
		truncated,
	};
}

function identityChanges(baseline, candidate) {
	const changes = [];
	for (const [field, severity, read] of PLUGIN_FIELDS) {
		const before = read(baseline.subject.plugin) ?? null;
		const after = read(candidate.subject.plugin) ?? null;
		if (before === after) continue;
		changes.push(
			change(
				"identity",
				"changed",
				`${field}: ${display(before)} -> ${display(after)}`,
				severity,
			),
		);
	}
	const before = upstreamIdentity(baseline);
	const after = upstreamIdentity(candidate);
	if (before === null && after === null) return changes;
	if (before === null || after === null) {
		changes.push(
			change(
				"identity",
				"changed",
				`source.upstream: ${before === null ? "<unverifiable>" : before.display} -> ${after === null ? "<unverifiable>" : after.display}`,
				"low",
			),
		);
		return changes;
	}
	for (const [field, severity, read] of UPSTREAM_FIELDS) {
		if (read(before) === read(after)) continue;
		changes.push(
			change(
				"identity",
				"changed",
				`${field}: ${display(read(before))} -> ${display(read(after))}`,
				severity,
			),
		);
	}
	return changes;
}

function graphChanges(baseline, candidate) {
	const changes = [];
	const before = nodeKeys(baseline);
	const after = nodeKeys(candidate);
	for (const [key, node] of after) {
		const previous = before.get(key);
		if (previous === undefined) {
			changes.push(change("graph", "added", key, addedNodeSeverity(node)));
			continue;
		}
		if (!platformsEqual(previous.effectivePlatforms, node.effectivePlatforms)) {
			changes.push(
				change(
					"graph",
					"changed",
					`${key}: ${formatPlatforms(previous.effectivePlatforms)} -> ${formatPlatforms(node.effectivePlatforms)}`,
					addedNodeSeverity(node),
				),
			);
		}
	}
	for (const [key] of before) {
		if (after.has(key)) continue;
		changes.push(change("graph", "removed", key, "info"));
	}
	const beforeEdges = edgeKeys(baseline);
	const afterEdges = edgeKeys(candidate);
	for (const [key, edge] of afterEdges) {
		const previous = beforeEdges.get(key);
		if (previous === undefined) {
			changes.push(change("graph", "added", key, "low"));
			continue;
		}
		if (!platformsEqual(previous.effectivePlatforms, edge.effectivePlatforms)) {
			changes.push(
				change(
					"graph",
					"changed",
					`${key}: ${formatPlatforms(previous.effectivePlatforms)} -> ${formatPlatforms(edge.effectivePlatforms)}`,
					"low",
				),
			);
		}
	}
	for (const [key] of beforeEdges) {
		if (afterEdges.has(key)) continue;
		changes.push(change("graph", "removed", key, "info"));
	}
	return changes;
}

function findingChanges(baseline, candidate) {
	const changes = [];
	const before = findingKeys(baseline);
	const after = findingKeys(candidate);
	for (const [key, finding] of after) {
		if (before.has(key)) continue;
		changes.push(change("finding", "added", key, finding.severity));
	}
	for (const [key] of before) {
		if (after.has(key)) continue;
		changes.push(change("finding", "removed", key, "info"));
	}
	return changes;
}

function completenessChanges(baseline, candidate) {
	const changes = [];
	const names = new Set([
		...Object.keys(baseline.completeness.dimensions),
		...Object.keys(candidate.completeness.dimensions),
	]);
	for (const name of [...names].sort()) {
		const before = baseline.completeness.dimensions[name]?.status ?? "absent";
		const after = candidate.completeness.dimensions[name]?.status ?? "absent";
		if (before === after) continue;
		changes.push(
			change(
				"completeness",
				"changed",
				`${name}: ${before} -> ${after}`,
				after === "complete" ? "info" : "medium",
			),
		);
	}
	if (baseline.completeness.unstable !== candidate.completeness.unstable) {
		changes.push(
			change(
				"completeness",
				"changed",
				`unstable: ${baseline.completeness.unstable} -> ${candidate.completeness.unstable}`,
				candidate.completeness.unstable ? "medium" : "info",
			),
		);
	}
	return changes;
}

function fileChanges(baseline, candidate) {
	const changes = [];
	const before = new Map(
		baseline.provenance.files.map((file) => [file.path, file.sha256]),
	);
	const after = new Map(
		candidate.provenance.files.map((file) => [file.path, file.sha256]),
	);
	for (const [path, hash] of after) {
		if (!before.has(path)) {
			changes.push(change("reachable-file", "added", path, "low"));
			continue;
		}
		if (before.get(path) !== hash) {
			changes.push(change("reachable-file", "changed", path, "low"));
		}
	}
	for (const path of before.keys()) {
		if (!after.has(path)) {
			changes.push(change("reachable-file", "removed", path, "info"));
		}
	}
	return changes;
}

function nodeKeys(receipt) {
	return new Map(
		receipt.graph.nodes.map((node) => [`${node.type}|${node.label}`, node]),
	);
}

function edgeKeys(receipt) {
	const labels = new Map(
		receipt.graph.nodes.map((node) => [node.id, `${node.type}|${node.label}`]),
	);
	return new Map(
		receipt.graph.edges.map((edge) => [
			`${edge.type}|${labels.get(edge.from) ?? edge.from}=>${labels.get(edge.to) ?? edge.to}`,
			edge,
		]),
	);
}

function findingKeys(receipt) {
	return new Map(
		receipt.findings.map((entry) => [`${entry.ruleId}|${entry.title}`, entry]),
	);
}

function addedNodeSeverity(node) {
	if (node.type === "trigger") {
		const label = String(node.label);
		if (AUTOMATIC_TRIGGER_LABELS.has(label) || label.startsWith("event")) {
			return "high";
		}
	}
	return ADDED_NODE_SEVERITY[node.type] ?? "medium";
}

function change(kind, verb, subject, severity) {
	return Object.freeze({
		kind,
		change: verb,
		subject: String(subject).slice(0, SUBJECT_MAX),
		severity,
	});
}

function normalizePlatforms(value) {
	if (!Array.isArray(value)) return [];
	return [...value].sort();
}

function formatPlatforms(value) {
	const normalized = normalizePlatforms(value);
	return normalized.length === 0 ? "<none>" : normalized.join(",");
}

function platformsEqual(left, right) {
	const leftNormalized = normalizePlatforms(left);
	const rightNormalized = normalizePlatforms(right);
	if (leftNormalized.length !== rightNormalized.length) return false;
	return leftNormalized.every((value, index) => value === rightNormalized[index]);
}

function compareChanges(left, right) {
	return (
		SEVERITY_ORDER.indexOf(right.severity) -
			SEVERITY_ORDER.indexOf(left.severity) ||
		left.kind.localeCompare(right.kind) ||
		left.change.localeCompare(right.change) ||
		left.subject.localeCompare(right.subject)
	);
}

function display(value) {
	return value === null ? "<none>" : String(value).slice(0, 256);
}
