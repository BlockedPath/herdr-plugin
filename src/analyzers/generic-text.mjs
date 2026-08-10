import { createCollector } from "./collector.mjs";
import { scanCommon } from "./common.mjs";
import { boundedLines, decodeText } from "./text.mjs";

export function analyzeGenericText(path, bytes, limits) {
	const decoded = decodeText(bytes, path);
	if (typeof decoded !== "string")
		return createCollector("unknown", path, limits, [decoded.error]).result();
	const bounded = boundedLines(decoded, path, limits);
	const collector = createCollector("text", path, limits, bounded.issues);
	scanCommon(bounded.lines, collector);
	return collector.result();
}
