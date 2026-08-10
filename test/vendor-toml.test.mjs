import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { DEFAULT_LIMITS } from "../src/config/limits.mjs";
import { parse } from "../vendor/toml/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const examples = join(here, "fixtures", "manifests", "examples");

const expectedHashes = new Map([
	[
		"date.js",
		"da5549142bbb43537c03dd9164ad434c3d5ffcc7f674e39e076e8cd23cc719c7",
	],
	[
		"error.js",
		"9f8d7d23f463a2993afa0aafe54a66e959949dbda7499949693f88115b461312",
	],
	[
		"extract.js",
		"473b6bb27daa2871e477bda09c626aef59c30fda09818a2221d32e96e2aa3b2a",
	],
	[
		"parse.js",
		"bf0c4aeb2645fb80d6743bc662990c4807c2858f55548113f60fe98fac6a8210",
	],
	[
		"primitive.js",
		"9bda902c6b763b75bcb154689dccd25fbd4fb7eca12d3ddffc6915c6c013e3ce",
	],
	[
		"struct.js",
		"8a7bdf55cd5e27e031e4b0dab6af8f28507e58eb81ef9c8dc84ba618d9eda647",
	],
	[
		"util.js",
		"d08c0ca8aad365eb8b51f961564a57e0275176ff5acc036e4939d47a2b945663",
	],
	[
		"LICENSE",
		"fa5659948374d4f555594f47f6da073b40dc503e921aeeece30df4362b3051a5",
	],
]);

test("vendored parser files match reviewed smol-toml 1.7.1 hashes", async () => {
	for (const [name, expected] of expectedHashes) {
		const bytes = await readFile(join(root, "vendor", "toml", name));
		const actual = createHash("sha256").update(bytes).digest("hex");
		assert.equal(actual, expected, name);
	}
});

test("parses representative published Herdr example manifests", async () => {
	const names = (await readdir(examples)).filter((name) =>
		name.endsWith(".toml"),
	);
	assert.equal(names.length, 4);

	for (const name of names) {
		const source = await readFile(join(examples, name), "utf8");
		const manifest = parse(source, { maxDepth: DEFAULT_LIMITS.tomlDepth });
		assert.match(manifest.id, /^[a-z0-9._-]+$/i, name);
		assert.equal(typeof manifest.name, "string", name);
		assert.ok(Array.isArray(manifest.platforms), name);
	}
});

test("preserves Herdr argv token boundaries and escaped regex text", () => {
	const manifest = parse(
		`
[[actions]]
id = "run"
command = ["bash", "-c", "printf '%s' \\"$VALUE\\""]

[[link_handlers]]
id = "link"
pattern = "^https://github\\\\.com/[^/]+$"
action = "run"
`,
		{ maxDepth: DEFAULT_LIMITS.tomlDepth },
	);

	assert.deepEqual(manifest.actions[0].command, [
		"bash",
		"-c",
		"printf '%s' \"$VALUE\"",
	]);
	assert.equal(
		manifest.link_handlers[0].pattern,
		"^https://github\\.com/[^/]+$",
	);
});

test("does not mutate Object.prototype for a __proto__ table", () => {
	const manifest = parse('[__proto__]\npolluted = "no"\n', {
		maxDepth: DEFAULT_LIMITS.tomlDepth,
	});
	assert.equal(Object.prototype.polluted, undefined);
	assert.ok(Object.hasOwn(manifest, "__proto__"));
	assert.equal(manifest.__proto__.polluted, "no");
});

test("rejects malformed TOML and excessive nesting", () => {
	assert.throws(() => parse("id = [", { maxDepth: DEFAULT_LIMITS.tomlDepth }));
	assert.throws(
		() => parse("value = [[[[1]]]]", { maxDepth: 2 }),
		/excessively nested structures/,
	);
});
