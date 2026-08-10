import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	CORE_COMPLETENESS_DIMENSIONS,
	validateReceiptContract,
} from "../src/receipt/contract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
	const source = await readFile(path, "utf8");
	try {
		return JSON.parse(source);
	} catch (error) {
		assert.fail(`${path} must contain valid JSON: ${error}`);
	}
}

test("receipt schema is Draft 2020-12 and closed at the root", async () => {
	const schema = await readJson(
		join(root, "schemas", "receipt-v1.schema.json"),
	);
	assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
	assert.equal(schema.properties.schemaVersion.const, 1);
	assert.equal(schema.additionalProperties, false);
	assert.ok(schema.required.includes("analysisHash"));
	assert.ok(schema.required.includes("receiptHash"));
	assert.match(schema.$defs.sha256.pattern, /sha256/);
	assert.ok(schema.$defs.source.required.includes("status"));
	assert.ok(schema.$defs.source.allOf.length >= 3);
	assert.ok(schema.allOf.length >= 1);

	const dimensions = schema.$defs.completeness.properties.dimensions;
	assert.deepEqual(dimensions.required, CORE_COMPLETENESS_DIMENSIONS);
	assert.equal(dimensions.additionalProperties, false);
});

test("receipt fixture contains every required root field", async () => {
	const schema = await readJson(
		join(root, "schemas", "receipt-v1.schema.json"),
	);
	const fixture = await readJson(
		join(root, "test", "fixtures", "receipt-v1.json"),
	);
	assert.deepEqual(Object.keys(fixture).sort(), [...schema.required].sort());
	assert.equal(fixture.schemaVersion, 1);
	assert.equal(fixture.tool.name, "herdr-xray");
	assert.match(fixture.analysisHash, /^sha256:[0-9a-f]{64}$/);
	assert.match(fixture.receiptHash, /^sha256:[0-9a-f]{64}$/);
	assert.deepEqual(validateReceiptContract(fixture), []);
});

test("incomplete fixture honestly represents unresolved source and plugin identity", async () => {
	const fixture = await readJson(
		join(root, "test", "fixtures", "receipt-v1-incomplete.json"),
	);
	assert.equal(fixture.completeness.complete, false);
	assert.equal(fixture.subject.plugin, null);
	assert.deepEqual(validateReceiptContract(fixture), []);
});

test("complete receipts reject missing identity, dimensions, and manifest provenance", async () => {
	const fixture = await readJson(
		join(root, "test", "fixtures", "receipt-v1.json"),
	);

	const missingIdentity = structuredClone(fixture);
	delete missingIdentity.subject.source.owner;
	missingIdentity.subject.plugin = null;
	assert.match(validateReceiptContract(missingIdentity).join("\n"), /owner/);
	assert.match(
		validateReceiptContract(missingIdentity).join("\n"),
		/plugin identity/,
	);

	const missingDimensions = structuredClone(fixture);
	missingDimensions.completeness.dimensions = {};
	assert.match(
		validateReceiptContract(missingDimensions).join("\n"),
		/missing source/,
	);

	const missingManifest = structuredClone(fixture);
	missingManifest.provenance.files = [];
	assert.match(
		validateReceiptContract(missingManifest).join("\n"),
		/manifest file provenance/,
	);

	const cleanupFailure = structuredClone(fixture);
	cleanupFailure.completeness.dimensions.cleanup = {
		status: "partial",
		reason: "Temporary output could not be removed.",
		limit: null,
	};
	assert.match(
		validateReceiptContract(cleanupFailure).join("\n"),
		/requires cleanup to be complete/,
	);
});

test("schema separates integrity and reproducible analysis hashes", async () => {
	const schema = await readJson(
		join(root, "schemas", "receipt-v1.schema.json"),
	);
	assert.ok(schema.properties.analysisHash);
	assert.ok(schema.properties.receiptHash);
	assert.notStrictEqual(
		schema.properties.analysisHash,
		schema.properties.receiptHash,
	);
});
