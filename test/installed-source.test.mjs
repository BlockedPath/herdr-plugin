import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditInstalled } from "../src/audit/audit.mjs";
import { EXIT } from "../src/cli/contract.mjs";
import { main } from "../src/cli/main.mjs";
import {
	HerdrCliError,
	herdrBinaryPath,
	listInstalledPlugins,
	parsePluginList,
} from "../src/herdr/cli.mjs";
import { validateReceiptContract } from "../src/receipt/contract.mjs";
import { resolveInstalledInput } from "../src/source/installed.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function envelope(plugins) {
	return { id: "cli:plugin", result: { type: "plugin_list", plugins } };
}

function pluginRecord(root, overrides = {}) {
	return {
		plugin_id: "example.installed",
		manifest_path: join(root, "herdr-plugin.toml"),
		plugin_root: root,
		source: {
			kind: "github",
			owner: "example-owner",
			repo: "example-repo",
			resolved_commit: COMMIT,
		},
		...overrides,
	};
}

function fakeSpawn(behavior) {
	const calls = [];
	const spawn = (binary, argv, options) => {
		calls.push({ binary, argv, options });
		if (behavior.throwOnSpawn === true) throw new Error("spawn refused");
		const child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.killed = false;
		child.kill = () => {
			child.killed = true;
			return true;
		};
		queueMicrotask(() => {
			if (behavior.error !== undefined) {
				child.emit("error", behavior.error);
				return;
			}
			if (behavior.stdout !== undefined) {
				child.stdout.emit("data", Buffer.from(behavior.stdout));
			}
			if (behavior.stderr !== undefined) {
				child.stderr.emit("data", Buffer.from(behavior.stderr));
			}
			if (behavior.stall === true) return;
			child.emit("close", behavior.status ?? 0);
		});
		return child;
	};
	return { spawn, calls };
}

async function withInstalledPlugin(run, files = {}) {
	const root = await mkdtemp(join(tmpdir(), "herdr-xray-installed-"));
	try {
		await writeFile(
			join(root, "herdr-plugin.toml"),
			`
id = "example.installed"
name = "Installed fixture"
version = "2.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos", "windows"]

[[actions]]
id = "run"
title = "Run"
command = ["node", "run.mjs"]
`,
		);
		await writeFile(
			join(root, "run.mjs"),
			`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(root, "EXECUTED"))}, "bad");\n`,
		);
		for (const [name, content] of Object.entries(files)) {
			await writeFile(join(root, name), content);
		}
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("plugin-list parsing requires the documented Herdr envelope and fields", () => {
	const parsed = parsePluginList(envelope([pluginRecord("/plugins/example")]));
	assert.equal(parsed.length, 1);
	assert.equal(parsed[0].pluginId, "example.installed");
	assert.equal(parsed[0].pluginRoot, "/plugins/example");
	assert.equal(parsed[0].source.resolvedCommit, COMMIT);

	for (const document of [
		null,
		{},
		{ result: { type: "other", plugins: [] } },
		{ result: { type: "plugin_list" } },
		{ result: { type: "plugin_list", plugins: [null] } },
		envelope([{ ...pluginRecord("/x"), plugin_root: undefined }]),
		envelope([{ ...pluginRecord("/x"), manifest_path: "" }]),
		envelope([{ ...pluginRecord("/x"), plugin_id: 7 }]),
	]) {
		assert.throws(
			() => parsePluginList(document),
			HerdrCliError,
			JSON.stringify(document),
		);
	}
});

test("plugin-list parsing keeps unverifiable upstream identity explicit", () => {
	const [withoutSource] = parsePluginList(
		envelope([{ ...pluginRecord("/x"), source: undefined }]),
	);
	assert.equal(withoutSource.source, null);

	const [badCommit] = parsePluginList(
		envelope([
			{
				...pluginRecord("/x"),
				source: { kind: "github", owner: "o", repo: "r", resolved_commit: "HEAD" },
			},
		]),
	);
	assert.equal(badCommit.source.resolvedCommit, null);
	assert.equal(badCommit.source.subdir, null);
	assert.equal(badCommit.source.requestedRef, null);
});

test("herdr binary resolution prefers HERDR_BIN_PATH and rejects unsafe values", () => {
	assert.equal(herdrBinaryPath({}), "herdr");
	assert.equal(herdrBinaryPath({ HERDR_BIN_PATH: "" }), "herdr");
	assert.equal(herdrBinaryPath({ HERDR_BIN_PATH: "/opt/herdr" }), "/opt/herdr");
	assert.throws(
		() => herdrBinaryPath({ HERDR_BIN_PATH: "/opt/her\ndr" }),
		HerdrCliError,
	);
});

test("herdr invocation uses argv without a shell and bounds its response", async () => {
	const ok = fakeSpawn({ stdout: JSON.stringify(envelope([pluginRecord("/x")])) });
	const plugins = await listInstalledPlugins({
		spawn: ok.spawn,
		herdrBinPath: "/opt/herdr",
	});
	assert.equal(plugins.length, 1);
	assert.deepEqual(ok.calls[0].argv, ["plugin", "list", "--json"]);
	assert.equal(ok.calls[0].binary, "/opt/herdr");
	assert.equal(ok.calls[0].options.shell, false);
	assert.deepEqual(ok.calls[0].options.stdio, ["ignore", "pipe", "pipe"]);

	const oversized = fakeSpawn({ stdout: "x".repeat(4096) });
	await assert.rejects(
		() =>
			listInstalledPlugins({
				spawn: oversized.spawn,
				limits: { herdrResponseBytes: 1024 },
			}),
		(error) => error.code === "herdr-response-too-large",
	);

	await assert.rejects(
		() => listInstalledPlugins({ spawn: fakeSpawn({ stdout: "{" }).spawn }),
		(error) => error.code === "herdr-invalid-json",
	);
	await assert.rejects(
		() =>
			listInstalledPlugins({
				spawn: fakeSpawn({ status: 3, stderr: "no such command" }).spawn,
			}),
		(error) =>
			error.code === "herdr-exit-status" && /no such command/.test(error.message),
	);
	await assert.rejects(
		() =>
			listInstalledPlugins({
				spawn: fakeSpawn({ error: new Error("ENOENT") }).spawn,
			}),
		(error) => error.code === "herdr-unavailable",
	);
	await assert.rejects(
		() => listInstalledPlugins({ spawn: fakeSpawn({ throwOnSpawn: true }).spawn }),
		(error) => error.code === "herdr-unavailable",
	);

	const stalled = fakeSpawn({ stall: true });
	await assert.rejects(
		() => listInstalledPlugins({ spawn: stalled.spawn, limits: { timeoutMs: 25 } }),
		(error) => error.code === "herdr-timeout",
	);
});

test("installed resolution fails explicitly instead of guessing plugin roots", async () => {
	await withInstalledPlugin(async (root) => {
		const plugins = parsePluginList(envelope([pluginRecord(root)]));
		const input = await resolveInstalledInput("example.installed", { plugins });
		assert.equal(input.kind, "installed");
		assert.equal(input.pluginId, "example.installed");
		assert.equal(input.installed.resolvedCommit, COMMIT);

		await assert.rejects(
			() => resolveInstalledInput("missing.plugin", { plugins }),
			(error) => error.code === "installed-plugin-not-found",
		);
		await assert.rejects(
			() =>
				resolveInstalledInput("example.installed", {
					plugins: parsePluginList(
						envelope([pluginRecord(root), pluginRecord(root)]),
					),
				}),
			(error) => error.code === "installed-plugin-ambiguous",
		);
		await assert.rejects(
			() => resolveInstalledInput("../escape", { plugins }),
			(error) => error.code === "invalid-plugin-id",
		);
		await assert.rejects(
			() =>
				resolveInstalledInput("example.installed", {
					plugins: parsePluginList(
						envelope([
							pluginRecord(root, { plugin_root: join(root, "missing") }),
						]),
					),
				}),
			(error) => error.code === "installed-root-unavailable",
		);
		await assert.rejects(
			() =>
				resolveInstalledInput("example.installed", {
					plugins: parsePluginList(
						envelope([
							pluginRecord(root, {
								manifest_path: join(root, "elsewhere.toml"),
							}),
						]),
					),
				}),
			(error) =>
				error.code === "installed-manifest-unavailable" ||
				error.code === "installed-manifest-outside-root",
		);
	});
});

test("installed manifests outside the reported root are refused", async () => {
	await withInstalledPlugin(
		async (root) => {
			await assert.rejects(
				() =>
					resolveInstalledInput("example.installed", {
						plugins: parsePluginList(
							envelope([
								pluginRecord(root, {
									manifest_path: join(root, "elsewhere.toml"),
								}),
							]),
						),
					}),
				(error) => error.code === "installed-manifest-outside-root",
			);
		},
		{ "elsewhere.toml": "id = \"other\"\n" },
	);
});

test("audit-installed produces a receipt without executing the installed plugin", async () => {
	await withInstalledPlugin(async (root) => {
		const receipt = await auditInstalled("example.installed", {
			plugins: parsePluginList(envelope([pluginRecord(root)])),
		});
		assert.deepEqual(validateReceiptContract(receipt), []);
		assert.equal(receipt.subject.source.kind, "installed");
		assert.equal(receipt.subject.source.display, "example.installed");
		assert.equal(receipt.subject.source.resolvedCommit, COMMIT);
		assert.equal(receipt.subject.source.owner, "example-owner");
		assert.match(receipt.subject.source.localRootHash, /^sha256:[0-9a-f]{64}$/);
		assert.equal(receipt.subject.plugin.id, "example.installed");
		assert.equal(JSON.stringify(receipt).includes(root), false);
		await assert.rejects(() => readFile(join(root, "EXECUTED")));
	});
});

test("audit-installed reports missing upstream identity without inventing one", async () => {
	await withInstalledPlugin(async (root) => {
		const receipt = await auditInstalled("example.installed", {
			plugins: parsePluginList(
				envelope([pluginRecord(root, { source: { kind: "local" } })]),
			),
		});
		assert.equal(receipt.subject.source.kind, "installed");
		assert.equal(receipt.subject.source.resolvedCommit, null);
		assert.equal(Object.hasOwn(receipt.subject.source, "owner"), false);
		assert.deepEqual(validateReceiptContract(receipt), []);
	});
});

test("audit-installed CLI renders JSON, rejects --ref, and reports Herdr failures", async () => {
	await withInstalledPlugin(async (root) => {
		const listing = JSON.stringify(envelope([pluginRecord(root)]));
		const capture = () => {
			let stdout = "";
			let stderr = "";
			return {
				io: {
					stdout: { write: (text) => (stdout += text) },
					stderr: { write: (text) => (stderr += text) },
					spawn: fakeSpawn({ stdout: listing }).spawn,
					herdrBinPath: "/opt/herdr",
				},
				output: () => ({ stdout, stderr }),
			};
		};

		const ok = capture();
		assert.equal(
			await main(["audit-installed", "example.installed", "--format", "json"], ok.io),
			EXIT.OK,
		);
		let receipt;
		try {
			receipt = JSON.parse(ok.output().stdout);
		} catch (error) {
			assert.fail(`expected a JSON receipt on stdout: ${error}`);
		}
		assert.equal(receipt.subject.source.kind, "installed");
		assert.equal(ok.output().stderr, "");

		const withRef = capture();
		assert.equal(
			await main(
				["audit-installed", "example.installed", "--ref", "main"],
				withRef.io,
			),
			EXIT.USAGE,
		);
		assert.match(withRef.output().stderr, /--ref is valid only for GitHub sources/);

		let stderr = "";
		assert.equal(
			await main(["audit-installed", "example.installed"], {
				stdout: { write: () => {} },
				stderr: { write: (text) => (stderr += text) },
				spawn: fakeSpawn({ status: 127, stderr: "herdr: not found" }).spawn,
			}),
			EXIT.INCOMPLETE,
		);
		assert.match(stderr, /audit-installed failed/);
	});
});

test("audit-installed reads a real Herdr process on POSIX hosts", { skip: process.platform === "win32" }, async () => {
	await withInstalledPlugin(async (root) => {
		const binary = join(root, "fake-herdr");
		await writeFile(
			binary,
			`#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(envelope([pluginRecord(root)]))}\nJSON\n`,
		);
		await chmod(binary, 0o755);
		const receipt = await auditInstalled("example.installed", {
			herdrBinPath: binary,
		});
		assert.equal(receipt.subject.source.kind, "installed");
		assert.equal(receipt.subject.plugin.id, "example.installed");
	});
});

test("installed sources still refuse symlinked plugin content", { skip: process.platform === "win32" }, async () => {
	await withInstalledPlugin(async (root) => {
		await symlink("/etc/hosts", join(root, "linked.mjs"));
		const receipt = await auditInstalled("example.installed", {
			plugins: parsePluginList(envelope([pluginRecord(root)])),
		});
		assert.equal(receipt.completeness.complete, false);
		assert.equal(
			receipt.findings.some((entry) => /symlink/i.test(entry.ruleId + entry.title)),
			true,
		);
	});
});
