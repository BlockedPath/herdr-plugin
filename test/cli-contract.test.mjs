import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../src/cli/main.mjs";
import { EXIT, HELP, VERSION_TEXT } from "../src/cli/contract.mjs";

function capture() {
	let stdout = "";
	let stderr = "";
	return {
		io: {
			stdout: {
				write: (value) => {
					stdout += value;
				},
			},
			stderr: {
				write: (value) => {
					stderr += value;
				},
			},
		},
		output: () => ({ stdout, stderr }),
	};
}

test("help is successful and documents policy options", async () => {
	const result = capture();
	assert.equal(await main([], result.io), EXIT.OK);
	assert.equal(result.output().stdout, HELP);
	assert.match(result.output().stdout, /--fail-on-severity low\|medium\|high/);
	assert.equal(result.output().stderr, "");
});

test("version is machine-simple and rejects extra arguments", async () => {
	const result = capture();
	assert.equal(await main(["version"], result.io), EXIT.OK);
	assert.equal(result.output().stdout, VERSION_TEXT);
	assert.equal(result.output().stderr, "");

	const invalid = capture();
	assert.equal(await main(["version", "extra"], invalid.io), EXIT.USAGE);
	assert.equal(invalid.output().stdout, "");
	assert.match(invalid.output().stderr, /does not accept arguments/);
});

test("unknown commands are usage errors on stderr", async () => {
	const result = capture();
	assert.equal(await main(["wat"], result.io), EXIT.USAGE);
	assert.equal(result.output().stdout, "");
	assert.match(result.output().stderr, /unknown command: wat/);
});

test("unimplemented planned commands fail explicitly during Milestone 1", async () => {
	for (const argv of [
		["marketplace-collisions", "--offline"],
		["receipt", "verify", "receipt.json"],
	]) {
		const result = capture();
		assert.equal(await main(argv, result.io), EXIT.INCOMPLETE, argv.join(" "));
		assert.equal(result.output().stdout, "");
		assert.match(result.output().stderr, /not implemented in Milestone 1/);
	}
});

test("malformed planned commands are usage errors", async () => {
	for (const argv of [
		["audit"],
		["audit", ".", "extra"],
		["audit", ".", "--wat"],
		["audit", ".", "--ref"],
		["audit", ".", "--offline", "--offline"],
		["audit", ".", "--format", "yaml"],
		["audit", ".", "--max-depth", "0"],
		["audit", ".", "--max-depth", "999"],
		["audit", "owner/repo", "--ref", "bad\nref"],
		["audit-installed"],
		["audit-installed", "a", "b"],
		["audit-installed", "example.plugin", "--ref", "main"],
		["compare", "example.plugin"],
		["compare", "example.plugin", "owner/repo", "extra"],
		["marketplace-collisions", "extra"],
		["receipt", "wat", "receipt.json"],
		["receipt", "verify"],
	]) {
		const result = capture();
		assert.equal(await main(argv, result.io), EXIT.USAGE, argv.join(" "));
		assert.equal(result.output().stdout, "");
		assert.match(result.output().stderr, /Run 'herdr-xray help'/);
	}
});

test("command help is available before implementation", async () => {
	const result = capture();
	assert.equal(await main(["audit", "--help"], result.io), EXIT.OK);
	assert.equal(result.output().stdout, HELP);
	assert.equal(result.output().stderr, "");
});
