import { createCollector } from "./collector.mjs";
import { recordEnvironment, scanCommon } from "./common.mjs";
import { boundedLines, decodeText } from "./text.mjs";

const ENV = /%([A-Za-z_][A-Za-z0-9_]*)%/g;
const CALL = /^\s*call\s+["']?([^\s"']+\.(?:bat|cmd))/i;

export function analyzeBatch(path, bytes, limits) {
	const decoded = decodeText(bytes, path);
	if (typeof decoded !== "string")
		return createCollector("batch", path, limits, [decoded.error]).result();
	const bounded = boundedLines(decoded, path, limits);
	const collector = createCollector("batch", path, limits, bounded.issues);
	const scannedLines = bounded.lines.map((line) =>
		/^\s*(?:rem(?:\s|$)|::)/i.test(line.text) ? { ...line, text: "" } : line,
	);
	scanCommon(scannedLines, collector);
	for (const line of scannedLines) {
		for (const match of line.text.matchAll(ENV))
			recordEnvironment(match[1], line.number, collector);
		const called = CALL.exec(line.text);
		if (called !== null)
			collector.reference("spawn-script", called[1], line.number);
		if (/\b(?:cmd\s+\/c|powershell(?:\.exe)?\s+-command)\b/i.test(line.text)) {
			collector.fact("shell-eval", "inline command interpreter", line.number, {
				dynamic: true,
				excerpt: line.text,
			});
		}
		if (/\b(?:curl|wget)\b[^|&\n]*%[A-Za-z_][A-Za-z0-9_]*%/i.test(line.text)) {
			collector.fact("dynamic-endpoint", "<computed>", line.number, {
				dynamic: true,
				confidence: "medium",
			});
			collector.issue(
				"dynamic-endpoint",
				"Batch network destination is computed",
				line.number,
			);
		}
		if (/^\s*(?:del|erase|copy|move|mkdir|rmdir)\b/i.test(line.text)) {
			collector.fact("filesystem-write", "<batch path>", line.number, {
				operation: "write",
				excerpt: line.text,
			});
		}
	}
	return collector.result();
}
