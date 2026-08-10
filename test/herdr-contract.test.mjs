import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const fixtures = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"herdr-0.8.0",
);

async function readJson(name) {
	const path = join(fixtures, name);
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		assert.fail(`${path} must contain valid JSON: ${error}`);
	}
}

test("Herdr 0.8.0 plugin-list fixture exposes installed audit fields", async () => {
	const envelope = await readJson("plugin-list.json");
	assert.equal(envelope.result.type, "plugin_list");
	assert.ok(Array.isArray(envelope.result.plugins));
	const [plugin] = envelope.result.plugins;
	assert.equal(typeof plugin.plugin_id, "string");
	assert.equal(typeof plugin.manifest_path, "string");
	assert.equal(typeof plugin.plugin_root, "string");
	assert.equal(plugin.source.kind, "github");
	assert.equal(typeof plugin.source.owner, "string");
	assert.equal(typeof plugin.source.repo, "string");
	assert.match(plugin.source.resolved_commit, /^[0-9a-f]{40}$/);
});

test("Herdr protocol 19 popup fixture supports string environment values", async () => {
	const fixture = await readJson("plugin-pane-open.schema.json");
	assert.equal(fixture.herdrVersion, "0.8.0");
	assert.equal(fixture.protocol, 19);
	assert.deepEqual(fixture.schema.required, ["plugin_id", "entrypoint"]);
	assert.equal(fixture.schema.properties.env.type, "object");
	assert.equal(
		fixture.schema.properties.env.additionalProperties.type,
		"string",
	);
});
