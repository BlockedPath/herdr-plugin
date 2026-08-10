import { createHash } from "node:crypto";
import { posix } from "node:path";

import { sourceFileId } from "../graph/build.mjs";
import { normalizeSourcePath } from "../source/filesystem-source.mjs";
import { analyzeReachableFile } from "./dispatch.mjs";

const RESOLUTION_EXTENSIONS = [
	"",
	".js",
	".mjs",
	".cjs",
	".ts",
	".py",
	".sh",
	".ps1",
	".cmd",
	".bat",
	"/index.js",
	"/index.mjs",
	"/__init__.py",
];

export async function traceReachable(options) {
	const { source, entries, initialPaths, limits } = options;
	const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
	const queue = [];
	const visited = new Set();
	const files = [];
	const facts = [];
	const issues = [];
	const nodes = new Map(
		(options.baseNodes ?? []).map((node) => [node.id, node]),
	);
	const edges = new Map(
		(options.baseEdges ?? []).map((edge) => [edge.id, edge]),
	);
	let analyzedBytes = options.initialBytes ?? 0;
	let analyzedFiles = options.initialFiles ?? 0;
	let graphNodeCount = options.baseNodeCount ?? 0;
	let graphEdgeCount = options.baseEdgeCount ?? 0;
	const evidenceLimit = Math.max(1, limits.findings);

	for (const path of initialPaths)
		enqueue(queue, path, 0, platformsFor(path, options.platformsByPath));
	if (entryByPath.get("package.json")?.type === "file") {
		enqueue(queue, "package.json", 0, options.defaultPlatforms);
	}

	while (queue.length > 0) {
		const item = queue.shift();
		const key = JSON.stringify([item.path, item.platforms]);
		if (visited.has(key)) continue;
		visited.add(key);
		if (item.depth > limits.traceDepth) {
			appendLimited(
				issues,
				traceIssue(
					"trace-depth-limit",
					`trace depth exceeded at ${item.path}`,
					item.path,
					null,
					"traceDepth",
				),
				evidenceLimit,
			);
			continue;
		}
		if (
			analyzedFiles >= limits.filesAnalyzed ||
			analyzedBytes >= limits.totalAnalysisBytes
		) {
			appendLimited(
				issues,
				traceIssue(
					"analysis-resource-limit",
					"analysis file or byte limit reached",
					item.path,
					null,
					"filesAnalyzed/totalAnalysisBytes",
				),
				evidenceLimit,
			);
			break;
		}
		const remaining = limits.totalAnalysisBytes - analyzedBytes;
		let file;
		try {
			file = await source.readFile(item.path, {
				maxBytes: Math.min(limits.singleTextFileBytes, remaining),
			});
		} catch (error) {
			appendLimited(
				issues,
				traceIssue(
					error?.code?.includes("limit")
						? "analysis-resource-limit"
						: "missing-reference",
					`reachable file could not be read: ${item.path}`,
					item.path,
					null,
					error?.code?.includes("limit") ? "singleTextFileBytes" : null,
				),
				evidenceLimit,
			);
			continue;
		}
		analyzedFiles += 1;
		analyzedBytes += file.bytes.length;
		const analysis = analyzeReachableFile({
			path: item.path,
			bytes: file.bytes,
			limits,
		});
		files.push(
			Object.freeze({
				...file,
				platforms: item.platforms,
				depth: item.depth,
				analysis,
			}),
		);
		for (const fact of analysis.facts) {
			if (!appendLimited(facts, fact, evidenceLimit)) {
				addLimitIssue(issues, "global analyzer fact limit reached", "findings");
			}
		}
		for (const issue of analysis.issues)
			appendLimited(issues, issue, evidenceLimit);

		const sourceId = sourceFileId(item.path, item.platforms);
		addGraphNode(
			nodes,
			{
				id: sourceId,
				type: "source-file",
				label: item.path,
				effectivePlatforms: item.platforms,
				attributes: {
					path: item.path,
					size: file.size,
					sha: file.sha ?? null,
					language: analysis.language,
				},
			},
			limits,
			issues,
			() => graphNodeCount,
			(value) => {
				graphNodeCount = value;
			},
		);

		for (const fact of analysis.facts) {
			const node = factNode(fact, item.platforms);
			if (
				!addGraphNode(
					nodes,
					node,
					limits,
					issues,
					() => graphNodeCount,
					(value) => {
						graphNodeCount = value;
					},
				)
			)
				continue;
			addGraphEdge(
				edges,
				sourceId,
				node.id,
				edgeType(fact.kind),
				item.platforms,
				provenance(item.path, fact.line, analysis.language),
				limits,
				issues,
				() => graphEdgeCount,
				(value) => {
					graphEdgeCount = value;
				},
			);
		}

		for (const reference of analysis.references) {
			const resolved = resolveReference(
				item.path,
				reference.value,
				item.platforms,
				entryByPath,
			);
			if (resolved.length === 0) {
				appendLimited(
					issues,
					traceIssue(
						"missing-reference",
						`static reference could not be resolved: ${reference.value}`,
						item.path,
						reference.line,
					),
					evidenceLimit,
				);
				continue;
			}
			for (const target of resolved) {
				const targetId = sourceFileId(target.path, target.platforms);
				addGraphNode(
					nodes,
					{
						id: targetId,
						type: "source-file",
						label: target.path,
						effectivePlatforms: target.platforms,
						attributes: {
							path: target.path,
							size: entryByPath.get(target.path)?.size ?? null,
							sha: entryByPath.get(target.path)?.sha ?? null,
						},
					},
					limits,
					issues,
					() => graphNodeCount,
					(value) => {
						graphNodeCount = value;
					},
				);
				addGraphEdge(
					edges,
					sourceId,
					targetId,
					reference.kind === "source"
						? "sources"
						: reference.kind === "spawn-script"
							? "spawns"
							: "imports",
					target.platforms,
					provenance(item.path, reference.line, analysis.language),
					limits,
					issues,
					() => graphEdgeCount,
					(value) => {
						graphEdgeCount = value;
					},
				);
				enqueue(queue, target.path, item.depth + 1, target.platforms);
			}
		}
	}

	return Object.freeze({
		files: Object.freeze(files),
		facts: Object.freeze(facts),
		issues: Object.freeze(issues),
		nodes: Object.freeze([...nodes.values()].sort(byId)),
		edges: Object.freeze([...edges.values()].sort(byId)),
		analyzedFiles,
		analyzedBytes,
		complete: issues.every((entry) => entry.affectsCompleteness === false),
	});
}

function resolveReference(origin, value, platforms, entries) {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(value)
	)
		return [];
	const results = new Map();
	for (const platform of platforms) {
		const windows = platform === "windows";
		const reference = windows ? value.replaceAll("\\", "/") : value;
		const joined = posix.normalize(
			posix.join(posix.dirname(origin), reference),
		);
		if (joined === ".." || joined.startsWith("../")) continue;
		for (const suffix of RESOLUTION_EXTENSIONS) {
			let candidate;
			try {
				candidate = normalizeSourcePath(`${joined}${suffix}`, {
					windows: false,
				});
			} catch {
				continue;
			}
			if (entries.get(candidate)?.type !== "file") continue;
			const existing = results.get(candidate) ?? [];
			results.set(candidate, [...new Set([...existing, platform])]);
			break;
		}
	}
	return [...results].map(([path, effectivePlatforms]) => ({
		path,
		platforms: effectivePlatforms,
	}));
}

function factNode(entry, platforms) {
	const mapping = {
		"network-endpoint": "network-endpoint",
		"dynamic-endpoint": "unknown",
		"environment-read": "environment-variable",
		"filesystem-write": "filesystem-path",
		"opaque-binary": "opaque-binary",
		subprocess: "subprocess",
		"dynamic-subprocess": "unknown",
		"dynamic-code": "unknown",
		"dynamic-import": "unknown",
		"shell-eval": "unknown",
		"download-to-shell": "unknown",
		"package-lifecycle": "package-lifecycle",
	};
	const type = mapping[entry.kind] ?? "unknown";
	return Object.freeze({
		id: stableId(type, [
			entry.kind,
			entry.value,
			entry.path,
			entry.line,
			platforms,
		]),
		type,
		label: String(entry.value).slice(0, 1024),
		effectivePlatforms: platforms,
		attributes: {
			kind: entry.kind,
			operation: entry.operation,
			dynamic: entry.dynamic,
		},
	});
}

function edgeType(kind) {
	if (kind === "network-endpoint") return "connects-to";
	if (kind === "environment-read") return "reads-environment";
	if (kind === "filesystem-write") return "writes-path";
	if (kind === "subprocess") return "spawns";
	return "resolves-dynamically";
}

function addGraphNode(target, node, limits, issues, getCount, setCount) {
	if (target.has(node.id)) return true;
	if (getCount() >= limits.graphNodes) {
		addLimitIssue(issues, "graph node limit reached", "graphNodes");
		return false;
	}
	target.set(node.id, Object.freeze(node));
	setCount(getCount() + 1);
	return true;
}

function addGraphEdge(
	target,
	from,
	to,
	type,
	platforms,
	source,
	limits,
	issues,
	getCount,
	setCount,
) {
	const id = stableId("edge", [from, to, type, platforms, source]);
	if (target.has(id)) return true;
	if (getCount() >= limits.graphEdges) {
		addLimitIssue(issues, "graph edge limit reached", "graphEdges");
		return false;
	}
	target.set(
		id,
		Object.freeze({
			id,
			type,
			from,
			to,
			effectivePlatforms: Object.freeze([...platforms]),
			confidence: "high",
			provenance: Object.freeze([source]),
		}),
	);
	setCount(getCount() + 1);
	return true;
}

function addLimitIssue(issues, message, limit) {
	if (!issues.some((entry) => entry.code === `limit:${limit}`)) {
		issues.push(traceIssue(`limit:${limit}`, message, null, null, limit));
	}
}

function appendLimited(target, value, limit) {
	if (target.length >= limit) return false;
	target.push(value);
	return true;
}

function traceIssue(code, message, path, line, limit = null) {
	return Object.freeze({
		code,
		message,
		path,
		line,
		affectsCompleteness: true,
		limit,
	});
}

function provenance(path, line, analyzerId) {
	return Object.freeze({
		kind: "analyzer",
		path,
		line,
		column: null,
		declaration: null,
		analyzerId,
	});
}

function enqueue(queue, path, depth, platforms) {
	if (!Array.isArray(platforms) || platforms.length === 0) return;
	queue.push(
		Object.freeze({ path, depth, platforms: Object.freeze([...platforms]) }),
	);
}

function platformsFor(path, map) {
	return map.get(path) ?? [];
}

function stableId(type, value) {
	return `${type}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)}`;
}

function byId(left, right) {
	if (left.id < right.id) return -1;
	if (left.id > right.id) return 1;
	return 0;
}
