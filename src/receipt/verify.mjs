import { open, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

import { resolveLimits } from "../config/limits.mjs";
import { sha256Value } from "./hash.mjs";
import { validateReceiptContract } from "./contract.mjs";

export class ReceiptVerifyError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "ReceiptVerifyError";
		this.code = code;
		this.details = details;
	}
}

export async function verifyReceipt(targetPath, options = {}) {
	const cwd = options.cwd ?? process.cwd();
	const limits = resolveLimits(options.limits ?? {});
	const maxBytes = limits.singleTextFileBytes;
	const absolute = resolve(cwd, targetPath);

	let handle;
	let bytes;
	try {
		const fileStat = await stat(absolute);
		if (!fileStat.isFile()) {
			throw new ReceiptVerifyError(
				"receipt-not-regular",
				`receipt path is not a regular file: ${targetPath}`,
			);
		}
		if (fileStat.size > maxBytes) {
			throw new ReceiptVerifyError(
				"receipt-too-large",
				`receipt exceeds ${maxBytes} bytes (was ${fileStat.size})`,
			);
		}
		handle = await open(absolute, constants.O_RDONLY);
		bytes = await readBounded(handle, maxBytes, targetPath);
	} catch (error) {
		if (error instanceof ReceiptVerifyError) throw error;
		throw new ReceiptVerifyError(
			"receipt-unreadable",
			`could not read receipt ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		await handle?.close();
	}

	let receipt;
	try {
		receipt = JSON.parse(bytes.toString("utf8"));
	} catch (error) {
		throw new ReceiptVerifyError(
			"receipt-invalid-json",
			`receipt is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const contractErrors = validateReceiptContract(receipt);
	if (contractErrors.length > 0) {
		throw new ReceiptVerifyError(
			"receipt-contract-failed",
			`receipt failed contract validation: ${contractErrors.join("; ")}`,
			{ errors: contractErrors },
		);
	}

	const expectedAnalysisHash = sha256Value({
		schemaVersion: receipt.schemaVersion,
		tool: receipt.tool,
		subject: receipt.subject,
		limits: receipt.limits,
		completeness: receipt.completeness,
		summary: receipt.summary,
		graph: receipt.graph,
		findings: receipt.findings,
		comparison: receipt.comparison,
		provenance: receipt.provenance,
	});

	if (receipt.analysisHash !== expectedAnalysisHash) {
		throw new ReceiptVerifyError(
			"receipt-analysis-hash-mismatch",
			`analysisHash mismatch: expected ${expectedAnalysisHash} but was ${receipt.analysisHash}`,
			{ expected: expectedAnalysisHash, actual: receipt.analysisHash },
		);
	}

	const { receiptHash, ...withoutReceiptHash } = receipt;
	const expectedReceiptHash = sha256Value(withoutReceiptHash);

	// Double-check canonicalization is stable: canonicalJson must be used for both, already via sha256Value.
	// Ensure we didn't accidentally include receiptHash in analysisProjection (we didn't).

	if (receiptHash !== expectedReceiptHash) {
		throw new ReceiptVerifyError(
			"receipt-hash-mismatch",
			`receiptHash mismatch: expected ${expectedReceiptHash} but was ${receiptHash}`,
			{ expected: expectedReceiptHash, actual: receiptHash },
		);
	}

	return receipt;
}

async function readBounded(handle, maxBytes, targetPath) {
	const chunks = [];
	let total = 0;
	const buffer = Buffer.alloc(64 * 1024);
	while (true) {
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
		if (bytesRead === 0) break;
		total += bytesRead;
		if (total > maxBytes) {
			throw new ReceiptVerifyError(
				"receipt-too-large",
				`receipt exceeds ${maxBytes} bytes while reading ${targetPath}`,
			);
		}
		chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
	}
	return Buffer.concat(chunks);
}

// Export canonical helper for testing that hashes are stable
export function recomputeHashes(receipt) {
	const analysisHash = sha256Value({
		schemaVersion: receipt.schemaVersion,
		tool: receipt.tool,
		subject: receipt.subject,
		limits: receipt.limits,
		completeness: receipt.completeness,
		summary: receipt.summary,
		graph: receipt.graph,
		findings: receipt.findings,
		comparison: receipt.comparison,
		provenance: receipt.provenance,
	});
	const withAnalysis = { ...receipt, analysisHash };
	delete withAnalysis.receiptHash;
	const receiptHash = sha256Value(withAnalysis);
	return { analysisHash, receiptHash };
}
