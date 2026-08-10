import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("package has no runtime dependencies or install-time script", async () => {
	let packageJson;
	try {
		packageJson = JSON.parse(
			await readFile(join(root, "package.json"), "utf8"),
		);
	} catch (error) {
		assert.fail(`package.json must contain valid JSON: ${error}`);
	}
	assert.deepEqual(packageJson.dependencies ?? {}, {});
	assert.equal(packageJson.scripts?.install, undefined);
	assert.equal(packageJson.scripts?.preinstall, undefined);
	assert.equal(packageJson.scripts?.postinstall, undefined);
	assert.equal(packageJson.type, "module");
	assert.match(packageJson.engines.node, />=20/);
});

test("repository ignores local subagent transcripts", async () => {
	const gitignore = await readFile(join(root, ".gitignore"), "utf8");
	assert.match(gitignore, /^\.pi-subagents\/$/m);
});

test("hashed files check out byte-identically on every platform", async () => {
	const attributes = await readFile(join(root, ".gitattributes"), "utf8");
	assert.match(attributes, /^\* text=auto eol=lf$/m);
	assert.match(attributes, /^vendor\/\*\* -text$/m);
	assert.match(attributes, /^test\/fixtures\/\*\* -text$/m);
	const parser = await readFile(join(root, "vendor", "toml", "date.js"));
	assert.equal(parser.includes(Buffer.from("\r\n")), false);
});
