import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildExecutionGraph } from "../src/graph/build.mjs";
import { parseManifest, ManifestError } from "../src/manifest/parse.mjs";
import { validateManifest } from "../src/manifest/validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function manifest(source) {
	return validateManifest(parseManifest(Buffer.from(source))).manifest;
}

function file(path, size = 1) {
	return Object.freeze({ path, type: "file", size });
}

test("validates every published example manifest fixture", async () => {
	const directory = join(here, "fixtures", "manifests", "examples");
	for (const name of await readdir(directory)) {
		const bytes = await readFile(join(directory, name));
		const result = validateManifest(parseManifest(bytes));
		assert.equal(result.manifest.id.startsWith("examples."), true, name);
		assert.equal(result.complete, true, name);
	}
});

test("normalizes all entrypoint surfaces and platform overrides", () => {
	const result = validateManifest(
		parseManifest(
			Buffer.from(`
id = "example.plugin"
name = "Example"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos", "windows"]

[[build]]
command = ["node", "scripts/build.mjs"]
platforms = ["linux", "macos"]

[[startup]]
command = ["python3", "scripts/missing.py"]

[[actions]]
id = "open"
title = "Open"
contexts = ["workspace"]
command = ["node", "scripts\\\\dual.mjs"]

[[events]]
on = "pane.focused"
command = ["sh", "-c", "printf focused"]

[[panes]]
id = "board"
title = "Board"
placement = "popup"
command = ["./bin/board"]

[[link_handlers]]
id = "github"
title = "Open GitHub"
pattern = "^https://github\\\\.com/"
action = "open"
`),
		),
	);
	assert.equal(result.complete, true);
	assert.deepEqual(
		result.manifest.declarations.map((item) => item.kind),
		["build", "startup", "action", "event", "pane", "link-handler"],
	);
	assert.deepEqual(result.manifest.declarations[0].effectivePlatforms, [
		"linux",
		"macos",
	]);
	assert.deepEqual(result.manifest.declarations[2].effectivePlatforms, [
		"linux",
		"macos",
		"windows",
	]);
});

test("builds platform-aware triggers, commands, link edges, and direct files", () => {
	const normalized = manifest(`
id = "example.plugin"
name = "Example"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos", "windows"]

[[build]]
command = ["node", "scripts/build.mjs"]
platforms = ["linux", "macos"]

[[startup]]
command = ["python3", "scripts/missing.py"]

[[actions]]
id = "open"
title = "Open"
command = ["node", "scripts\\\\dual.mjs"]

[[link_handlers]]
id = "link"
title = "Link"
pattern = "^https://github\\\\.com/"
action = "open"
`);
	const graph = buildExecutionGraph(normalized, [
		file("scripts/build.mjs"),
		file("scripts\\dual.mjs"),
		file("scripts/dual.mjs"),
	]);
	assert.deepEqual(graph.reachablePaths, [
		"scripts/build.mjs",
		"scripts/dual.mjs",
		"scripts\\dual.mjs",
	]);
	assert.equal(
		graph.issues.some((issue) => issue.code === "missing-reference"),
		true,
	);
	const posixFile = graph.nodes.find(
		(node) => node.label === "scripts\\dual.mjs",
	);
	const windowsFile = graph.nodes.find(
		(node) => node.label === "scripts/dual.mjs",
	);
	assert.deepEqual(posixFile.effectivePlatforms.sort(), ["linux", "macos"]);
	assert.deepEqual(windowsFile.effectivePlatforms, ["windows"]);
	const linkTrigger = graph.nodes.find(
		(node) => node.label === "link-handler:link",
	);
	const actionTrigger = graph.nodes.find(
		(node) => node.label === "action:open",
	);
	assert.equal(
		graph.edges.some(
			(edge) => edge.from === linkTrigger.id && edge.to === actionTrigger.id,
		),
		true,
	);
});

test("reports forward fields and missing link actions without hiding them", () => {
	const parsed = parseManifest(
		Buffer.from(`
id = "example.plugin"
name = "Example"
version = "1"
min_herdr_version = "0.8.0"
future_execution = true

[[link_handlers]]
id = "missing"
title = "Missing"
pattern = "x"
action = "nope"
`),
	);
	const result = validateManifest(parsed);
	assert.equal(result.complete, false);
	assert.equal(
		result.issues.some((issue) => issue.code === "unknown-field"),
		true,
	);
	const graph = buildExecutionGraph(result.manifest, []);
	assert.equal(graph.complete, false);
	assert.equal(
		graph.issues.some((issue) => issue.code === "missing-action"),
		true,
	);
});

test("rejects malformed manifests and duplicate local IDs", () => {
	assert.throws(
		() => validateManifest(parseManifest(Buffer.from('id = "only"\n'))),
		ManifestError,
	);
	assert.throws(
		() =>
			manifest(`
id = "example.plugin"
name = "Example"
version = "1"
min_herdr_version = "0.8.0"
[[actions]]
id = "same"
title = "One"
command = ["node", "one.mjs"]
[[actions]]
id = "same"
title = "Two"
command = ["node", "two.mjs"]
`),
		(error) => error instanceof ManifestError && error.code === "duplicate-id",
	);
});

test("interpreter options preserve preload and main scripts without tracing data arguments", () => {
	const normalized = manifest(`
id = "example.args"
name = "Args"
version = "1"
min_herdr_version = "0.8.0"
[[actions]]
id = "node"
title = "Node"
command = ["node", "-r", "hook.js", "main.js", "-e", "data", "https://example.test/value", "/tmp/data"]
`);
	const graph = buildExecutionGraph(normalized, [
		file("hook.js"),
		file("main.js"),
	]);
	assert.deepEqual(graph.reachablePaths, ["hook.js", "main.js"]);
	assert.equal(
		graph.issues.some((entry) => entry.path === "https://example.test/value"),
		false,
	);
	assert.equal(
		graph.issues.some((entry) => entry.path === "/tmp/data"),
		false,
	);
});

test("traces bare Windows executables without treating them as POSIX cwd commands", () => {
	const normalized = manifest(`
id = "example.windows"
name = "Windows"
version = "1"
min_herdr_version = "0.8.0"
platforms = ["windows"]
[[actions]]
id = "run"
title = "Run"
command = ["payload.exe"]
`);
	const graph = buildExecutionGraph(normalized, [file("payload.exe")]);
	assert.deepEqual(graph.reachablePaths, ["payload.exe"]);
	const executable = graph.nodes.find(
		(node) => node.label === "payload.exe" && node.type === "source-file",
	);
	assert.deepEqual(executable.effectivePlatforms, ["windows"]);
});

test("graph identities survive declaration reordering", () => {
	const header = `
id = "example.plugin"
name = "Example"
version = "1"
min_herdr_version = "0.8.0"
`;
	const one = `
[[actions]]
id = "one"
title = "One"
command = ["node", "one.mjs"]
`;
	const two = `
[[actions]]
id = "two"
title = "Two"
command = ["node", "two.mjs"]
`;
	const entries = [file("one.mjs"), file("two.mjs")];
	const before = buildExecutionGraph(manifest(header + one + two), entries);
	const after = buildExecutionGraph(manifest(header + two + one), entries);
	assert.deepEqual(
		before.nodes.map((node) => node.id),
		after.nodes.map((node) => node.id),
	);
	assert.deepEqual(
		before.edges.map((edge) => edge.id),
		after.edges.map((edge) => edge.id),
	);
});
