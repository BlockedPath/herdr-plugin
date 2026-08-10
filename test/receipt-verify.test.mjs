import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditSource } from "../src/audit/audit.mjs";
import { EXIT } from "../src/cli/contract.mjs";
import { main } from "../src/cli/main.mjs";
import { verifyReceipt } from "../src/receipt/verify.mjs";

async function withReceipt(run, manifest = null) {
	const root = await mkdtemp(join(tmpdir(), "herdr-xray-verify-"));
	try {
		await writeFile(
			join(root, "herdr-plugin.toml"),
			manifest ??
				`
id = "example.verify"
name = "Verify fixture"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos", "windows"]

[[actions]]
id = "run"
title = "Run"
command = ["node", "run.mjs"]
`,
		);
		await writeFile(join(root, "run.mjs"), "export const v = 1;\n");
		const receipt = await auditSource(root);
		const path = join(root, "receipt.json");
		await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
		await run({ root, receipt, path });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("valid receipt verifies and survives CLI round-trip", async () => {
	await withReceipt(async ({ path }) => {
		const loaded = await verifyReceipt(path);
		assert.equal(loaded.schemaVersion, 1);

		let stdout = "";
		let stderr = "";
		assert.equal(
			await main(["receipt", "verify", path], {
				stdout: { write: (v) => (stdout += v) },
				stderr: { write: (v) => (stderr += v) },
			}),
			EXIT.OK,
		);
		assert.match(stdout, /is valid/);
		assert.equal(stderr, "");
	});
});

test("any mutation invalidates the correct hash", async () => {
	await withReceipt(async ({ path }) => {
		const original = JSON.parse(await readFile(path, "utf8"));

		// Mutating a stable field must break analysisHash (stable projection)
		const tamperedStable = {
			...original,
			subject: {
				...original.subject,
				plugin: { ...original.subject.plugin, version: "9.9.9" },
			},
		};
		await writeFile(path, JSON.stringify(tamperedStable));
		await assert.rejects(
			() => verifyReceipt(path),
			(error) => /analysisHash mismatch/.test(error.message),
		);

		let stderr = "";
		assert.equal(
			await main(["receipt", "verify", path], {
				stdout: { write: () => {} },
				stderr: { write: (v) => (stderr += v) },
			}),
			EXIT.RECEIPT_INVALID,
		);
		assert.match(stderr, /analysisHash mismatch/);

		// Mutating generatedAt must break receiptHash but not analysisHash
		const tamperedTime = {
			...original,
			generatedAt: "2000-01-01T00:00:00.000Z",
		};
		// Need to recompute receipt without updating hashes to simulate tamper
		await writeFile(path, JSON.stringify(tamperedTime));
		await assert.rejects(
			() => verifyReceipt(path),
			(error) => /receiptHash mismatch/.test(error.message),
		);
	});
});

test("invalid JSON and contract failures are receipt-invalid", async () => {
	await withReceipt(async ({ path }) => {
		await writeFile(path, "{ not json");
		await assert.rejects(
			() => verifyReceipt(path),
			(error) => error.code === "receipt-invalid-json",
		);

		// Write a minimal object missing required fields
		await writeFile(path, JSON.stringify({ schemaVersion: 1 }));
		await assert.rejects(
			() => verifyReceipt(path),
			(error) => error.code === "receipt-contract-failed",
		);
		let stderr = "";
		assert.equal(
			await main(["receipt", "verify", path], {
				stdout: { write: () => {} },
				stderr: { write: (v) => (stderr += v) },
			}),
			EXIT.RECEIPT_INVALID,
		);
		assert.match(stderr, /contract/);
	});
});

test("oversized receipt is bounded", async () => {
	await withReceipt(async ({ path }) => {
		await assert.rejects(
			() => verifyReceipt(path, { limits: { singleTextFileBytes: 10 } }),
			(error) => error.code === "receipt-too-large",
		);
	});
});

test("receipt verify usage errors are exit 2", async () => {
	let stderr = "";
	assert.equal(
		await main(["receipt", "verify"], {
			stdout: { write: () => {} },
			stderr: { write: (v) => (stderr += v) },
		}),
		EXIT.USAGE,
	);
	assert.match(stderr, /receipt requires/);

	stderr = "";
	assert.equal(
		await main(["receipt", "verify", "a", "b"], {
			stdout: { write: () => {} },
			stderr: { write: (v) => (stderr += v) },
		}),
		EXIT.USAGE,
	);
});
