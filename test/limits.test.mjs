import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_LIMITS,
	HARD_LIMITS,
	resolveLimits,
} from "../src/config/limits.mjs";

test("default and hard limit keys match", () => {
	assert.deepEqual(Object.keys(DEFAULT_LIMITS), Object.keys(HARD_LIMITS));
});

test("defaults are positive and never exceed hard limits", () => {
	for (const [name, value] of Object.entries(DEFAULT_LIMITS)) {
		assert.equal(Number.isSafeInteger(value), true, name);
		assert.ok(value >= 0, name);
		assert.ok(value <= HARD_LIMITS[name], name);
	}
});

test("GitHub operation caps compose without a generic response ambiguity", () => {
	assert.ok(
		DEFAULT_LIMITS.githubCommitResponseBytes <=
			DEFAULT_LIMITS.githubTotalResponseBytes,
	);
	assert.ok(
		DEFAULT_LIMITS.githubTreeResponseBytes <=
			DEFAULT_LIMITS.githubTotalResponseBytes,
	);
	assert.ok(
		DEFAULT_LIMITS.githubBlobResponseBytes <=
			DEFAULT_LIMITS.githubTotalResponseBytes,
	);
	assert.ok(
		DEFAULT_LIMITS.githubBlobDecodedBytes <= DEFAULT_LIMITS.totalAnalysisBytes,
	);
	assert.equal(
		Object.hasOwn(DEFAULT_LIMITS, "githubSingleResponseBytes"),
		false,
	);
});

test("manifest parser has explicit byte and nesting limits", () => {
	assert.ok(DEFAULT_LIMITS.manifestBytes <= DEFAULT_LIMITS.singleTextFileBytes);
	assert.equal(DEFAULT_LIMITS.tomlDepth, 64);
	assert.equal(HARD_LIMITS.tomlDepth, 128);
});

test("limit overrides are validated against hard maximums", () => {
	const resolved = resolveLimits({ githubRequests: 1 });
	assert.equal(resolved.githubRequests, 1);
	assert.equal(Object.isFrozen(resolved), true);
	for (const overrides of [
		{ githubRequests: Infinity },
		{ githubRequests: HARD_LIMITS.githubRequests + 1 },
		{ githubRequests: -1 },
		{ githubRequests: "1" },
		{ madeUpLimit: 1 },
	]) {
		assert.throws(() => resolveLimits(overrides), { name: "RangeError" });
	}
});

test("redirects are prohibited", () => {
	assert.equal(DEFAULT_LIMITS.httpRedirects, 0);
	assert.equal(HARD_LIMITS.httpRedirects, 0);
});
