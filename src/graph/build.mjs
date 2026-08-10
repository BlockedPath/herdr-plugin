import { createHash } from "node:crypto";

import { normalizeSourcePath } from "../source/filesystem-source.mjs";

const INTERPRETERS = new Set([
	"node",
	"node.exe",
	"bun",
	"deno",
	"python",
	"python3",
	"python.exe",
	"py",
	"ruby",
	"perl",
	"lua",
	"bash",
	"sh",
	"zsh",
	"fish",
	"pwsh",
	"powershell",
	"powershell.exe",
]);
const INLINE_FLAGS = new Set(["-c", "-e", "--eval", "--print", "-command"]);
const SCRIPT_EXTENSIONS =
	/\.(?:[cm]?js|ts|py|rb|pl|lua|sh|bash|zsh|fish|ps1|cmd|bat)$/i;

export function buildExecutionGraph(manifest, sourceEntries) {
	const nodes = new Map();
	const edges = new Map();
	const issues = [];
	const reachablePaths = new Set();
	const entryByPath = new Map(
		sourceEntries.map((entry) => [entry.path, entry]),
	);
	const actionTriggers = new Map();
	const triggerByDeclaration = new Map();
	const occurrences = new Map();

	addNode(nodes, {
		id: stableId("plugin", JSON.stringify([manifest.id, manifest.platforms])),
		type: "plugin",
		label: manifest.id,
		effectivePlatforms: manifest.platforms,
		attributes: { name: manifest.name, version: manifest.version },
	});

	for (const declaration of manifest.declarations) {
		const semantic = declarationSemantic(declaration);
		const occurrence = occurrences.get(semantic) ?? 0;
		occurrences.set(semantic, occurrence + 1);
		const triggerId = stableId("trigger", `${semantic}\0${occurrence}`);
		const provenance = manifestProvenance(triggerId);
		addNode(nodes, {
			id: triggerId,
			type: "trigger",
			label: triggerLabel(declaration),
			effectivePlatforms: declaration.effectivePlatforms,
			attributes: {
				kind: declaration.kind,
				automatic: ["build", "startup", "event"].includes(declaration.kind),
				id: declaration.id ?? null,
				event: declaration.on ?? null,
			},
		});
		triggerByDeclaration.set(declaration, triggerId);
		if (declaration.kind === "action") {
			actionTriggers.set(declaration.id, triggerId);
		}

		if (declaration.command !== undefined) {
			const commandId = stableId(
				"command",
				JSON.stringify([declaration.command, declaration.effectivePlatforms]),
			);
			addNode(nodes, {
				id: commandId,
				type: "command",
				label: declaration.command.join(" ").slice(0, 1024),
				effectivePlatforms: declaration.effectivePlatforms,
				attributes: { argv: declaration.command },
			});
			addEdge(
				edges,
				triggerId,
				commandId,
				"invokes",
				declaration.effectivePlatforms,
				provenance,
			);
			traceDirectFiles(
				declaration,
				commandId,
				entryByPath,
				nodes,
				edges,
				issues,
				reachablePaths,
				provenance,
			);
		}
	}

	for (const declaration of manifest.declarations.filter(
		(entry) => entry.kind === "link-handler",
	)) {
		const sourceId = triggerByDeclaration.get(declaration);
		const targetId = actionTriggers.get(declaration.action);
		if (targetId === undefined) {
			issues.push(
				graphIssue(
					"missing-action",
					`link handler ${declaration.id} references missing action ${declaration.action}`,
					manifestProvenance(sourceId),
				),
			);
			continue;
		}
		const targetPlatforms = nodes.get(targetId).effectivePlatforms;
		const effectivePlatforms = declaration.effectivePlatforms.filter(
			(platform) => targetPlatforms.includes(platform),
		);
		if (effectivePlatforms.length === 0) {
			issues.push(
				graphIssue(
					"platform-mismatch",
					`link handler ${declaration.id} and action ${declaration.action} have no shared platform`,
					manifestProvenance(sourceId),
				),
			);
			continue;
		}
		addEdge(
			edges,
			sourceId,
			targetId,
			"invokes",
			effectivePlatforms,
			manifestProvenance(sourceId),
		);
	}

	return Object.freeze({
		nodes: Object.freeze([...nodes.values()].sort(byId)),
		edges: Object.freeze([...edges.values()].sort(byId)),
		issues: Object.freeze(issues),
		reachablePaths: Object.freeze([...reachablePaths].sort()),
		complete: issues.length === 0,
	});
}

function traceDirectFiles(
	declaration,
	commandId,
	entries,
	nodes,
	edges,
	issues,
	reachable,
	provenance,
) {
	const argv = declaration.command;
	const executable = executableName(argv[0]);
	let candidates = [];
	if (INTERPRETERS.has(executable)) {
		candidates = interpreterCandidates(argv);
	} else if (
		looksLikeDirectExecutable(argv[0], declaration.effectivePlatforms)
	) {
		candidates = [argv[0]];
	}

	for (const candidate of candidates) {
		const candidatePlatforms = isWindowsBareExecutable(candidate)
			? declaration.effectivePlatforms.filter(
					(platform) => platform === "windows",
				)
			: declaration.effectivePlatforms;
		const platformPaths = candidatePaths(candidate, candidatePlatforms);
		let resolvedAny = false;
		for (const [path, platforms] of platformPaths) {
			const entry = entries.get(path);
			if (entry === undefined) {
				continue;
			}
			resolvedAny = true;
			if (entry.type !== "file") {
				issues.push(
					graphIssue(
						entry.type === "submodule" ? "submodule" : "non-regular-reference",
						`command references ${entry.type} entry ${path}`,
						provenance,
						path,
					),
				);
				continue;
			}
			reachable.add(path);
			const fileId = sourceFileId(path, platforms);
			addNode(nodes, {
				id: fileId,
				type: "source-file",
				label: path,
				effectivePlatforms: platforms,
				attributes: { path, size: entry.size, sha: entry.sha ?? null },
			});
			addEdge(edges, commandId, fileId, "invokes", platforms, provenance);
		}
		if (!resolvedAny) {
			issues.push(
				graphIssue(
					"missing-reference",
					`command references a file that is not present: ${candidate}`,
					provenance,
					candidate,
				),
			);
		}
	}
}

function candidatePaths(candidate, platforms) {
	const paths = new Map();
	const posixPlatforms = platforms.filter((platform) => platform !== "windows");
	if (posixPlatforms.length > 0)
		addCandidate(paths, candidate, posixPlatforms, false);
	if (platforms.includes("windows"))
		addCandidate(paths, candidate, ["windows"], true);
	return paths;
}

function addCandidate(target, candidate, platforms, windows) {
	const stripped =
		candidate.startsWith("./") || candidate.startsWith(".\\")
			? candidate.slice(2)
			: candidate;
	try {
		const path = normalizeSourcePath(stripped, { windows });
		const existing = target.get(path) ?? [];
		target.set(path, [...new Set([...existing, ...platforms])]);
	} catch {
		// Absolute and parent-traversing command paths are not plugin-local files.
	}
}

function interpreterCandidates(argv) {
	const candidates = [];
	const pathOptions = new Set(["-r", "--require", "--loader", "--import"]);
	for (let index = 1; index < argv.length; index += 1) {
		const argument = argv[index];
		if (INLINE_FLAGS.has(argument.toLowerCase()) && candidates.length === 0)
			return [];
		if (pathOptions.has(argument.toLowerCase())) {
			const preload = argv[index + 1];
			if (preload !== undefined && looksLikeLocalScript(preload))
				candidates.push(preload);
			index += 1;
			continue;
		}
		if (argument.startsWith("-")) continue;
		if (looksLikeLocalScript(argument)) candidates.push(argument);
		break;
	}
	return candidates;
}

function looksLikeLocalScript(value) {
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.startsWith("/"))
		return false;
	return (
		value.startsWith("./") ||
		value.startsWith(".\\") ||
		value.includes("/") ||
		value.includes("\\") ||
		SCRIPT_EXTENSIONS.test(value)
	);
}

function looksLikeDirectExecutable(value, platforms) {
	if (value.startsWith("../") || value.startsWith("..\\")) return false;
	return (
		value.startsWith("./") ||
		value.startsWith(".\\") ||
		value.includes("/") ||
		value.includes("\\") ||
		(platforms.includes("windows") && isWindowsBareExecutable(value))
	);
}

function isWindowsBareExecutable(value) {
	return (
		!value.includes("/") &&
		!value.includes("\\") &&
		/\.(?:exe|cmd|bat|ps1)$/i.test(value)
	);
}

function executableName(value) {
	return value.replaceAll("\\", "/").split("/").at(-1).toLowerCase();
}

function declarationSemantic(declaration) {
	return JSON.stringify({
		kind: declaration.kind,
		id: declaration.id ?? null,
		on: declaration.on ?? null,
		pattern: declaration.pattern ?? null,
		action: declaration.action ?? null,
		command: declaration.command ?? null,
		platforms: declaration.effectivePlatforms,
	});
}

function triggerLabel(declaration) {
	if (declaration.id !== undefined)
		return `${declaration.kind}:${declaration.id}`;
	if (declaration.on !== undefined) return `event:${declaration.on}`;
	return declaration.kind;
}

function manifestProvenance(triggerId) {
	return Object.freeze({
		kind: "manifest",
		path: "herdr-plugin.toml",
		line: null,
		column: null,
		declaration: triggerId,
		analyzerId: "manifest-graph",
	});
}

function graphIssue(code, message, provenance, path = null) {
	return Object.freeze({
		code,
		message,
		provenance,
		path,
		affectsCompleteness: true,
	});
}

function addNode(target, node) {
	const existing = target.get(node.id);
	if (existing === undefined) {
		target.set(node.id, Object.freeze(node));
		return;
	}
	const platforms = [
		...new Set([...existing.effectivePlatforms, ...node.effectivePlatforms]),
	].sort();
	target.set(
		node.id,
		Object.freeze({
			...existing,
			effectivePlatforms: Object.freeze(platforms),
		}),
	);
}

function addEdge(target, from, to, type, platforms, provenance) {
	const id = stableId(
		"edge",
		JSON.stringify([from, to, type, platforms, provenance.declaration]),
	);
	target.set(
		id,
		Object.freeze({
			id,
			type,
			from,
			to,
			effectivePlatforms: Object.freeze([...platforms]),
			confidence: "high",
			provenance: Object.freeze([provenance]),
		}),
	);
}

export function sourceFileId(path, platforms) {
	return stableId("source-file", JSON.stringify([path, platforms]));
}

function stableId(type, value) {
	return `${type}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function byId(left, right) {
	if (left.id < right.id) return -1;
	if (left.id > right.id) return 1;
	return 0;
}
