import { createHash } from "node:crypto";

export function canonicalJson(value) {
	return JSON.stringify(canonicalValue(value));
}

export function sha256Value(value) {
	return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function finalizeReceipt(receipt) {
	const analysisProjection = {
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
	};
	const withAnalysisHash = {
		...receipt,
		analysisHash: sha256Value(analysisProjection),
	};
	const integrityProjection = { ...withAnalysisHash };
	delete integrityProjection.receiptHash;
	return Object.freeze({
		...withAnalysisHash,
		receiptHash: sha256Value(integrityProjection),
	});
}

function canonicalValue(value) {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonicalValue(value[key])]),
		);
	}
	return value;
}
