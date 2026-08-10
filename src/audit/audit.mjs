import { createHash } from "node:crypto";

import { traceReachable } from "../analyzers/trace.mjs";
import { DEFAULT_LIMITS } from "../config/limits.mjs";
import { buildExecutionGraph } from "../graph/build.mjs";
import { parseManifest } from "../manifest/parse.mjs";
import { validateManifest } from "../manifest/validate.mjs";
import { RECEIPT_SCHEMA_VERSION, RULES_VERSION, VERSION } from "../meta.mjs";
import { finalizeReceipt, sha256Value } from "../receipt/hash.mjs";
import { redactReceipt } from "../receipt/redact.mjs";
import { createFinding } from "../rules/finding.mjs";
import { openInstalledSource, openSource } from "../source/open.mjs";
import { enrichWithMarketplace } from "../marketplace/enrich.mjs";
import { persistReceipt } from "../receipt/persist.mjs";

export async function auditSource(rawSource, options = {}) {
	return await auditOpened(await openSource(rawSource, options), options);
}

export async function auditInstalled(pluginId, options = {}) {
	return await auditOpened(
		await openInstalledSource(pluginId, options),
		options,
	);
}

async function auditOpened(opened, options) {
	const { input, source } = opened;
	const entries = await source.listEntries();
	const manifestFile = await source.readFile("herdr-plugin.toml", {
		maxBytes: Math.min(
			source.limits.manifestBytes,
			source.limits.totalAnalysisBytes,
		),
	});
	const validation = validateManifest(
		parseManifest(manifestFile.bytes, {
			maxBytes: source.limits.manifestBytes,
			maxDepth: source.limits.tomlDepth,
		}),
	);
	const declarationLimit = Math.max(
		0,
		Math.min(
			validation.manifest.declarations.length,
			Math.floor((source.limits.graphNodes - 1) / 3),
			Math.floor(source.limits.graphEdges / 2),
		),
	);
	let graphLimited = declarationLimit < validation.manifest.declarations.length;
	const graphManifest = graphLimited
		? {
				...validation.manifest,
				declarations: validation.manifest.declarations.slice(
					0,
					declarationLimit,
				),
			}
		: validation.manifest;
	const rawGraph = buildExecutionGraph(graphManifest, entries);
	graphLimited ||=
		rawGraph.nodes.length > source.limits.graphNodes ||
		rawGraph.edges.length > source.limits.graphEdges;
	const graph = graphLimited
		? {
				...rawGraph,
				nodes: rawGraph.nodes.slice(0, source.limits.graphNodes),
				edges: rawGraph.edges.slice(0, source.limits.graphEdges),
				complete: false,
			}
		: rawGraph;

	const platformsByPath = new Map();
	for (const node of graph.nodes.filter(
		(entry) => entry.type === "source-file",
	)) {
		const current = platformsByPath.get(node.attributes.path) ?? [];
		platformsByPath.set(node.attributes.path, [
			...new Set([...current, ...node.effectivePlatforms]),
		]);
	}
	const trace = await traceReachable({
		source,
		entries,
		initialPaths: graph.reachablePaths,
		limits: source.limits,
		platformsByPath,
		defaultPlatforms: validation.manifest.platforms,
		initialBytes: manifestFile.bytes.length,
		initialFiles: 1,
		baseNodeCount: graph.nodes.length,
		baseEdgeCount: graph.edges.length,
		baseNodes: graph.nodes,
		baseEdges: graph.edges,
	});
	const fileEntries = [
		fileProvenance(manifestFile, "manifest"),
		...trace.files.map((file) =>
			fileProvenance(
				file,
				file.path === "package.json" ? "metadata" : "reachable-source",
			),
		),
	];
	const files = [
		...new Map(fileEntries.map((file) => [file.path, file])).values(),
	];
	const reachableIssues = [
		...(graphLimited
			? [
					{
						code: "resource-limit",
						message: "execution graph resource limit reached",
						path: null,
						provenance: { declaration: "graph" },
					},
				]
			: []),
		...trace.issues.map((entry) => ({
			...entry,
			provenance: {
				declaration: entry.path ?? "analysis",
				analyzerId: "bounded-trace",
			},
		})),
	];
	const reachableComplete = !graphLimited && trace.complete;
	const receiptGraph = mergeGraph(graph, trace, source.limits);
	if (typeof source.verifyStable === "function") await source.verifyStable();

	const unsafeEntries = entries.filter(
		(entry) => entry.type === "symlink" || entry.type === "other",
	);
	const entryIssues = unsafeEntries
		.slice(0, source.limits.findings)
		.map((entry) => ({
			code:
				entry.type === "symlink" ? "external-symlink" : "non-regular-reference",
			message: `source contains ${entry.type} entry: ${entry.path}`,
			path: entry.path,
			provenance: { declaration: entry.path },
		}));
	const graphFindingInputs = [...graph.issues, ...entryIssues];
	const findingGroups = [
		[graphManifest.declarations, declarationFindings],
		[validation.issues, manifestIssueFindings],
		[graphFindingInputs, graphIssueFindings],
		[trace.facts, analyzerFactFindings],
		[
			reachableIssues,
			(items, limit) => analyzerIssueFindings(items, trace.facts, limit),
		],
		[source.issues ?? [], sourceIssueFindings],
	];
	let findings = [];
	let findingsLimited = false;
	for (const [items, convert] of findingGroups) {
		const remaining = source.limits.findings - findings.length;
		if (remaining <= 0) {
			if (items.length > 0) findingsLimited = true;
			continue;
		}
		const produced = convert(items, remaining);
		findings.push(...produced);
		if (items.length > remaining) findingsLimited = true;
	}
	findings = dedupeFindings(findings).sort((left, right) =>
		left.id.localeCompare(right.id),
	);
	if (findingsLimited) {
		findings =
			source.limits.findings === 0
				? []
				: [
						...findings.slice(0, source.limits.findings - 1),
						finding(
							"xray.dynamic.resource-limit",
							"Finding limit reached",
							"Additional findings were omitted.",
							"findings",
						),
					];
	}
	const sourceComplete =
		(source.issues?.length ?? 0) === 0 &&
		source.unstable !== true &&
		unsafeEntries.length === 0;
	const executionComplete = graph.complete && !graphLimited;
	const analysisComplete =
		executionComplete && reachableComplete && !findingsLimited;
	const dimensions = {
		source: status(
			sourceComplete,
			"Source acquisition reported truncation or instability.",
		),
		manifest: status(
			validation.complete,
			"Manifest contains unknown execution-relevant fields.",
		),
		executionGraph: status(
			executionComplete,
			"Execution graph contains unresolved references.",
		),
		reachableSource: status(
			reachableComplete,
			"One or more reachable files could not be read.",
		),
		analysis: status(
			analysisComplete,
			"Bounded static analysis contains unresolved behavior.",
		),
		cleanup: status(true, null),
	};
	const complete = Object.values(dimensions).every(
		(dimension) => dimension.status === "complete",
	);
	const summary = summarize(findings);
	const localRootHash =
		input.kind === "github"
			? null
			: sha256Value(files.map((file) => [file.path, file.sha256]));
	const receipt = {
		schemaVersion: RECEIPT_SCHEMA_VERSION,
		tool: { name: "herdr-xray", version: VERSION, rulesVersion: RULES_VERSION },
		generatedAt: new Date().toISOString(),
		subject: {
			source: sourceSubject(input, source, localRootHash),
			plugin: {
				id: validation.manifest.id,
				name: validation.manifest.name,
				version: validation.manifest.version,
				minHerdrVersion: validation.manifest.minHerdrVersion,
				platforms: validation.manifest.platforms,
			},
			installedBaseline: null,
		},
		limits: source.limits ?? DEFAULT_LIMITS,
		completeness: { complete, unstable: source.unstable === true, dimensions },
		summary,
		graph: receiptGraph,
		findings,
		comparison: null,
		provenance: {
			manifestPath: "herdr-plugin.toml",
			files: files.sort((left, right) => left.path.localeCompare(right.path)),
			analyzers: [
				{ id: "manifest", version: 1 },
				{ id: "manifest-graph", version: 1 },
				{ id: "bounded-trace", version: 1 },
			],
		},
		analysisHash: "",
		receiptHash: "",
	};
	let final = finalizeReceipt(
		redactReceipt(receipt, options.redaction ?? "strict"),
	);
	if (options.marketplaceCheck && options.marketplaceCheck !== "off") {
		try {
			final = await enrichWithMarketplace(final, options);
		} catch {}
	}
	if (options.persist === true && process.env.HERDR_PLUGIN_STATE_DIR) {
		try {
			await persistReceipt(final, options);
		} catch {}
	} else if (options.persist === true && !process.env.HERDR_PLUGIN_STATE_DIR) {
		// Outside Herdr, persist to XDG state dir best-effort only if explicitly requested via env
		try {
			await persistReceipt(final, options);
		} catch {}
	}
	return final;
}

function declarationFindings(declarations, limit = Number.POSITIVE_INFINITY) {
	const mapping = {
		build: [
			"xray.execution.install-build",
			"Install-time build command",
			"The plugin declares a command that runs during GitHub installation.",
		],
		startup: [
			"xray.execution.server-startup",
			"Server startup command",
			"The plugin declares a command that runs when the Herdr server starts.",
		],
		event: [
			"xray.execution.event-hook",
			"Event-driven command",
			"The plugin declares a command that runs when a Herdr event occurs.",
		],
		"link-handler": [
			"xray.execution.link-handler",
			"Link handler",
			"A modified link click can invoke a same-plugin action.",
		],
	};
	return declarations.slice(0, limit).flatMap((declaration) => {
		const details = mapping[declaration.kind];
		if (details === undefined) return [];
		return [
			finding(
				details[0],
				details[1],
				details[2],
				`${declaration.kind}:${declaration.id ?? declaration.on ?? declaration.index}`,
			),
		];
	});
}

function manifestIssueFindings(issues, limit = Number.POSITIVE_INFINITY) {
	return issues.slice(0, limit).map((entry) => {
		const ruleId =
			entry.code === "platforms-missing"
				? "xray.identity.platforms-missing"
				: "xray.dynamic.unknown-manifest-field";
		return finding(ruleId, entry.message, entry.message, entry.path);
	});
}

function graphIssueFindings(issues, limit = Number.POSITIVE_INFINITY) {
	return issues.slice(0, limit).map((entry) => {
		let ruleId = "xray.dynamic.missing-reference";
		if (entry.code === "submodule") ruleId = "xray.dynamic.submodule";
		if (entry.code === "external-symlink")
			ruleId = "xray.dynamic.external-symlink";
		if (entry.code === "resource-limit") ruleId = "xray.dynamic.resource-limit";
		return finding(
			ruleId,
			entry.message,
			entry.message,
			entry.path ?? entry.provenance.declaration,
		);
	});
}

function analyzerFactFindings(facts, limit = Number.POSITIVE_INFINITY) {
	return facts.slice(0, limit).flatMap((entry) => {
		let ruleId = null;
		if (entry.kind === "package-lifecycle")
			ruleId = "xray.package.lifecycle-script";
		if (entry.kind === "network-endpoint") ruleId = "xray.network.endpoint";
		if (entry.kind === "dynamic-endpoint")
			ruleId = "xray.network.dynamic-endpoint";
		if (
			entry.kind === "environment-read" &&
			entry.operation === "credential-like"
		) {
			ruleId = "xray.credential.environment-read";
		}
		if (entry.kind === "filesystem-write")
			ruleId = "xray.filesystem.external-write";
		if (entry.kind === "opaque-binary") {
			ruleId =
				entry.operation === "wasm"
					? "xray.opaque.wasm"
					: "xray.opaque.native-binary";
		}
		if (entry.kind === "dynamic-subprocess")
			ruleId = "xray.execution.dynamic-subprocess";
		if (entry.kind === "dynamic-code") ruleId = "xray.execution.dynamic-code";
		if (entry.kind === "dynamic-import")
			ruleId = "xray.execution.dynamic-import";
		if (entry.kind === "shell-eval")
			ruleId = "xray.execution.shell-inline-eval";
		if (entry.kind === "download-to-shell")
			ruleId = "xray.execution.download-to-shell";
		if (ruleId === null) return [];
		return [
			finding(
				ruleId,
				`${entry.kind}: ${entry.value}`,
				`Static analysis observed ${entry.kind}.`,
				`${entry.path}:${entry.line ?? 0}:${entry.value}`,
				{
					path: entry.path,
					line: entry.line,
					excerpt: entry.excerpt,
					confidence: entry.confidence,
				},
			),
		];
	});
}

function analyzerIssueFindings(
	issues,
	facts,
	limit = Number.POSITIVE_INFINITY,
) {
	const represented = new Set(
		facts.map((entry) => JSON.stringify([entry.kind, entry.path, entry.line])),
	);
	return issues.slice(0, limit).flatMap((entry) => {
		const representedKind = {
			"dynamic-subprocess": "dynamic-subprocess",
			"dynamic-endpoint": "dynamic-endpoint",
			"dynamic-code": "dynamic-code",
			"dynamic-import": "dynamic-import",
		}[entry.code];
		if (
			representedKind !== undefined &&
			represented.has(JSON.stringify([representedKind, entry.path, entry.line]))
		) {
			return [];
		}
		if (entry.code === "opaque-binary" || entry.code === "opaque-wasm")
			return [];
		let ruleId = "xray.dynamic.unsupported-language";
		if (entry.code === "dynamic-subprocess")
			ruleId = "xray.execution.dynamic-subprocess";
		if (entry.code === "dynamic-endpoint")
			ruleId = "xray.network.dynamic-endpoint";
		if (entry.code === "dynamic-code") ruleId = "xray.execution.dynamic-code";
		if (entry.code === "dynamic-import")
			ruleId = "xray.execution.dynamic-import";
		if (entry.code === "dynamic-write")
			ruleId = "xray.filesystem.dynamic-write";
		if (entry.code === "missing-reference")
			ruleId = "xray.dynamic.missing-reference";
		if (entry.code === "git-lfs") ruleId = "xray.dynamic.git-lfs";
		if (entry.code.includes("limit") || entry.limit !== null)
			ruleId = "xray.dynamic.resource-limit";
		return [
			finding(
				ruleId,
				entry.message,
				entry.message,
				`${entry.path ?? "analysis"}:${entry.line ?? 0}:${entry.code}`,
				{ path: entry.path, line: entry.line, excerpt: null },
			),
		];
	});
}

function sourceIssueFindings(issues, limit = Number.POSITIVE_INFINITY) {
	return issues
		.slice(0, limit)
		.map((entry) =>
			finding(
				entry.code === "upstream-unverified"
					? "xray.identity.upstream-unverified"
					: "xray.dynamic.resource-limit",
				entry.message,
				entry.message,
				entry.code,
			),
		);
}

function finding(ruleId, title, explanation, subject, evidence = {}) {
	return createFinding(ruleId, title, explanation, subject, evidence);
}

function mergeGraph(base, trace, limits) {
	const nodes = new Map();
	const edges = new Map();
	for (const node of [...base.nodes, ...trace.nodes]) {
		if (!nodes.has(node.id) && nodes.size < limits.graphNodes)
			nodes.set(node.id, node);
	}
	for (const edge of [...base.edges, ...trace.edges]) {
		if (!edges.has(edge.id) && edges.size < limits.graphEdges)
			edges.set(edge.id, edge);
	}
	return Object.freeze({
		nodes: Object.freeze(
			[...nodes.values()].sort((left, right) =>
				left.id.localeCompare(right.id),
			),
		),
		edges: Object.freeze(
			[...edges.values()].sort((left, right) =>
				left.id.localeCompare(right.id),
			),
		),
	});
}

function fileProvenance(file, role) {
	return Object.freeze({
		path: file.path,
		sha256: `sha256:${createHash("sha256").update(file.bytes).digest("hex")}`,
		bytes: file.bytes.length,
		role,
	});
}

function sourceSubject(input, source, localRootHash) {
	if (input.kind === "github") {
		return {
			kind: "github",
			status: "resolved",
			display: input.display,
			owner: input.owner,
			repo: input.repo,
			subdir: input.subdir,
			requestedRef: input.requestedRef,
			resolvedCommit: source.resolvedCommit,
			localRootHash: null,
		};
	}
	if (input.kind === "installed") {
		const upstream = input.installed;
		const github =
			upstream?.kind === "github" &&
			upstream.owner !== null &&
			upstream.repo !== null;
		return {
			kind: "installed",
			status: "resolved",
			display: input.pluginId,
			...(github
				? {
						owner: upstream.owner,
						repo: upstream.repo,
						subdir: upstream.subdir,
						requestedRef: upstream.requestedRef,
					}
				: {}),
			resolvedCommit: github ? upstream.resolvedCommit : null,
			localRootHash,
		};
	}
	return {
		kind: "local",
		status: "resolved",
		display: "<local-plugin>",
		resolvedCommit: null,
		localRootHash,
	};
}

function status(complete, reason) {
	return complete
		? { status: "complete", reason: null, limit: null }
		: { status: "partial", reason, limit: null };
}

function dedupeFindings(findings) {
	const unique = new Map();
	for (const entry of findings) {
		const evidence = entry.evidence[0] ?? {};
		const key = JSON.stringify([
			entry.ruleId,
			evidence.path,
			evidence.line,
			entry.title,
		]);
		if (!unique.has(key)) unique.set(key, entry);
	}
	return [...unique.values()];
}

function summarize(findings) {
	const summary = {
		facts: 0,
		heuristics: 0,
		unknowns: 0,
		bySeverity: { info: 0, low: 0, medium: 0, high: 0 },
	};
	for (const entry of findings) {
		if (entry.class === "fact") summary.facts += 1;
		if (entry.class === "heuristic") summary.heuristics += 1;
		if (entry.class === "unknown") summary.unknowns += 1;
		summary.bySeverity[entry.severity] += 1;
	}
	return summary;
}
