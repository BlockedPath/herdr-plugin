import assert from "node:assert/strict";
import test from "node:test";

import { RULES } from "../src/rules/registry.mjs";

const classifications = new Set(["fact", "heuristic", "unknown"]);
const severities = new Set(["info", "low", "medium", "high"]);
const categories = new Set([
	"identity",
	"execution",
	"network",
	"credential",
	"filesystem",
	"package",
	"opaque",
	"dynamic",
]);

test("rule registry uses stable unique IDs and valid dimensions", () => {
	const ids = new Set();
	for (const rule of RULES) {
		assert.match(rule.id, /^xray\.[a-z0-9-]+\.[a-z0-9-]+$/);
		assert.equal(ids.has(rule.id), false, rule.id);
		ids.add(rule.id);
		assert.equal(classifications.has(rule.classification), true, rule.id);
		assert.equal(severities.has(rule.severity), true, rule.id);
		assert.equal(categories.has(rule.category), true, rule.id);
		assert.equal(Object.isFrozen(rule), true, rule.id);
	}
	assert.equal(ids.size, 29);
});

test("registry contains facts, heuristics, and explicit unknowns", () => {
	assert.deepEqual(
		[...new Set(RULES.map((rule) => rule.classification))].sort(),
		["fact", "heuristic", "unknown"],
	);
});
