import { createCollector } from "./collector.mjs";
import { recordEnvironment, scanCommon } from "./common.mjs";
import { boundedLines, decodeText } from "./text.mjs";

const IMPORT_PATTERNS = [
	/\bimport\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g,
	/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
	/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const SUBPROCESS_PATTERN =
	/\b(?:exec|execFile|spawn|spawnSync|execSync)\s*\(([^)]*)/g;
const ENV_DOT = /\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
const ENV_INDEX = /\bprocess\.env\s*\[\s*["']([^"']+)["']\s*\]/g;
const WRITE_PATTERN =
	/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rm|rmSync|unlink|unlinkSync|mkdir|mkdirSync)\s*\(([^)]*)/g;
const NETWORK_PATTERN =
	/\b(?:fetch|request|axios(?:\.(?:get|post|put|delete))?|https?\.request)\s*\(([^)]*)/g;

export function analyzeJavaScript(path, bytes, limits) {
	const decoded = decodeText(bytes, path);
	if (typeof decoded !== "string")
		return createCollector("javascript", path, limits, [
			decoded.error,
		]).result();
	const bounded = boundedLines(decoded, path, limits);
	const collector = createCollector("javascript", path, limits, bounded.issues);
	const scannedLines = stripComments(bounded.lines);
	scanCommon(scannedLines, collector);
	for (const line of scannedLines) {
		for (const pattern of IMPORT_PATTERNS) {
			for (const match of line.text.matchAll(pattern)) {
				if (match[1].startsWith("."))
					collector.reference("import", match[1], line.number);
			}
		}
		if (/\bimport\s*\(\s*(?!["'])/.test(line.text)) {
			collector.fact("dynamic-import", "<computed>", line.number, {
				dynamic: true,
			});
			collector.issue(
				"dynamic-import",
				"JavaScript import target is computed",
				line.number,
			);
		}
		for (const match of line.text.matchAll(NETWORK_PATTERN)) {
			const literal = firstLiteral(match[1]);
			if (literal === null || !/^https?:\/\//i.test(literal)) {
				collector.fact("dynamic-endpoint", "<computed>", line.number, {
					dynamic: true,
					confidence: "medium",
				});
				collector.issue(
					"dynamic-endpoint",
					"network destination is computed",
					line.number,
				);
			}
		}
		for (const match of line.text.matchAll(ENV_DOT))
			recordEnvironment(match[1], line.number, collector);
		for (const match of line.text.matchAll(ENV_INDEX))
			recordEnvironment(match[1], line.number, collector);
		for (const match of line.text.matchAll(SUBPROCESS_PATTERN)) {
			const literal = firstLiteral(match[1]);
			if (literal === null) {
				collector.fact("dynamic-subprocess", "<computed>", line.number, {
					dynamic: true,
					confidence: "medium",
				});
				collector.issue(
					"dynamic-subprocess",
					"subprocess command is computed",
					line.number,
				);
			} else {
				collector.fact("subprocess", literal, line.number, {
					operation: "spawn",
					excerpt: literal,
					confidence: "medium",
				});
				if (looksLocal(literal))
					collector.reference("spawn-script", literal, line.number);
			}
		}
		for (const match of line.text.matchAll(WRITE_PATTERN)) {
			const literal = firstLiteral(match[1]);
			if (literal === null)
				collector.issue(
					"dynamic-write",
					"filesystem write path is computed",
					line.number,
				);
			else
				collector.fact("filesystem-write", literal, line.number, {
					operation: "write",
					excerpt: literal,
				});
		}
		if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(line.text)) {
			collector.fact("dynamic-code", "eval", line.number, { dynamic: true });
			collector.issue(
				"dynamic-code",
				"dynamic JavaScript evaluation is present",
				line.number,
			);
		}
	}
	return collector.result();
}

function stripComments(lines) {
	let inBlock = false;
	return lines.map((line) => {
		let output = "";
		let quote = null;
		let escaped = false;
		for (let index = 0; index < line.text.length; index += 1) {
			const current = line.text[index];
			const next = line.text[index + 1];
			if (inBlock) {
				if (current === "*" && next === "/") {
					inBlock = false;
					index += 1;
				}
				continue;
			}
			if (quote !== null) {
				output += current;
				if (escaped) escaped = false;
				else if (current === "\\") escaped = true;
				else if (current === quote) quote = null;
				continue;
			}
			if (current === "/" && next === "/") break;
			if (current === "/" && next === "*") {
				inBlock = true;
				index += 1;
				continue;
			}
			if (current === '"' || current === "'" || current === "`")
				quote = current;
			output += current;
		}
		return { ...line, text: output };
	});
}

function firstLiteral(value) {
	const match = /^\s*["']([^"']*)["']/.exec(value);
	return match?.[1] ?? null;
}

function looksLocal(value) {
	return value.startsWith(".") || value.includes("/") || value.includes("\\");
}
