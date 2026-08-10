import { analysisResult, analyzerIssue, fact } from "./model.mjs";

export function classifyBinary(bytes) {
	if (starts(bytes, [0x7f, 0x45, 0x4c, 0x46])) return "elf";
	if (starts(bytes, [0x4d, 0x5a])) return "pe";
	if (starts(bytes, [0x00, 0x61, 0x73, 0x6d])) return "wasm";
	if (
		starts(bytes, [0xfe, 0xed, 0xfa, 0xce]) ||
		starts(bytes, [0xce, 0xfa, 0xed, 0xfe]) ||
		starts(bytes, [0xfe, 0xed, 0xfa, 0xcf]) ||
		starts(bytes, [0xcf, 0xfa, 0xed, 0xfe]) ||
		starts(bytes, [0xca, 0xfe, 0xba, 0xbe])
	)
		return "mach-o";
	if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0))
		return "binary";
	return null;
}

export function analyzeBinary(path, format) {
	const ruleKind = format === "wasm" ? "wasm" : "native-binary";
	return analysisResult("binary", {
		facts: [fact("opaque-binary", format, path, null, { operation: ruleKind })],
		issues: [
			analyzerIssue(
				format === "wasm" ? "opaque-wasm" : "opaque-binary",
				`reachable ${format} content is opaque to static analysis`,
				path,
			),
		],
	});
}

function starts(bytes, prefix) {
	if (bytes.length < prefix.length) return false;
	return prefix.every((value, index) => bytes[index] === value);
}
