import { createCollector } from "./collector.mjs";
import { recordEnvironment, scanCommon } from "./common.mjs";
import { boundedLines, decodeText } from "./text.mjs";

const ENV_INDEX = /\bos\.environ\s*\[\s*["']([^"']+)["']\s*\]/g;
const ENV_GET = /\bos\.(?:getenv|environ\.get)\s*\(\s*["']([^"']+)["']/g;
const SUBPROCESS =
	/\bsubprocess\.(?:run|Popen|call|check_call|check_output)\s*\((.*)/g;
const RUN_PATH = /\b(?:runpy\.run_path|execfile)\s*\(\s*["']([^"']+)["']/g;
const WRITE =
	/\bopen\s*\(\s*([^,]+),\s*["'][wax+][^"']*["']|\.(?:write_text|write_bytes|unlink|mkdir)\s*\(/g;
const RELATIVE_IMPORT =
	/^\s*from\s+(\.+)([A-Za-z_][A-Za-z0-9_.]*)?\s+import\s+([A-Za-z_][A-Za-z0-9_]*)/;
const NETWORK =
	/\b(?:requests|httpx)\.(?:get|post|put|delete|request)\s*\(([^)]*)|\burllib\.request\.urlopen\s*\(([^)]*)/g;

export function analyzePython(path, bytes, limits) {
	const decoded = decodeText(bytes, path);
	if (typeof decoded !== "string")
		return createCollector("python", path, limits, [decoded.error]).result();
	const bounded = boundedLines(decoded, path, limits);
	const collector = createCollector("python", path, limits, bounded.issues);
	const scannedLines = stripPythonComments(bounded.lines);
	scanCommon(scannedLines, collector);
	for (const line of scannedLines) {
		for (const match of line.text.matchAll(ENV_INDEX)) {
			if (isCodePosition(line.text, match.index))
				recordEnvironment(match[1], line.number, collector);
		}
		for (const match of line.text.matchAll(ENV_GET)) {
			if (isCodePosition(line.text, match.index))
				recordEnvironment(match[1], line.number, collector);
		}
		for (const match of line.text.matchAll(RUN_PATH)) {
			if (isCodePosition(line.text, match.index))
				collector.reference("import", match[1], line.number);
		}
		const relativeImport = RELATIVE_IMPORT.exec(line.text);
		if (relativeImport !== null) {
			const parents = "../".repeat(Math.max(0, relativeImport[1].length - 1));
			const module = relativeImport[2] ?? relativeImport[3];
			const modulePath = `${parents}${module.replaceAll(".", "/")}`;
			collector.reference("import", modulePath, line.number);
			if (relativeImport[2] !== undefined) {
				collector.reference(
					"import",
					`${modulePath}/${relativeImport[3]}`,
					line.number,
				);
			}
		}
		const importIndex = line.text.search(
			/\bimportlib\.import_module\s*\(\s*(?!["'])/,
		);
		if (importIndex !== -1 && isCodePosition(line.text, importIndex)) {
			collector.issue(
				"dynamic-import",
				"Python import target is computed",
				line.number,
			);
		}
		for (const match of line.text.matchAll(NETWORK)) {
			if (!isCodePosition(line.text, match.index)) continue;
			const argument = match[1] ?? match[2] ?? "";
			if (!/^\s*["']https?:\/\//i.test(argument)) {
				collector.fact("dynamic-endpoint", "<computed>", line.number, {
					dynamic: true,
					confidence: "medium",
				});
				collector.issue(
					"dynamic-endpoint",
					"Python network destination is computed",
					line.number,
				);
			}
		}
		for (const match of line.text.matchAll(SUBPROCESS)) {
			if (!isCodePosition(line.text, match.index)) continue;
			const literal =
				/^(?:\s*\[\s*)?["']([^"']+)["']/.exec(match[1])?.[1] ?? null;
			if (literal === null) {
				collector.fact("dynamic-subprocess", "<computed>", line.number, {
					dynamic: true,
				});
				collector.issue(
					"dynamic-subprocess",
					"Python subprocess command is computed",
					line.number,
				);
			} else {
				collector.fact("subprocess", literal, line.number, {
					operation: "spawn",
					excerpt: literal,
				});
				if (literal.startsWith(".") || literal.includes("/"))
					collector.reference("spawn-script", literal, line.number);
			}
		}
		for (const match of line.text.matchAll(WRITE)) {
			if (isCodePosition(line.text, match.index)) {
				collector.fact("filesystem-write", "<write call>", line.number, {
					operation: "write",
					excerpt: line.text,
				});
			}
		}
		const dynamicIndex = line.text.search(/\b(?:eval|exec)\s*\(/);
		if (dynamicIndex !== -1 && isCodePosition(line.text, dynamicIndex)) {
			collector.fact("dynamic-code", "eval/exec", line.number, {
				dynamic: true,
			});
			collector.issue(
				"dynamic-code",
				"dynamic Python evaluation is present",
				line.number,
			);
		}
	}
	return collector.result();
}

function stripPythonComments(lines) {
	let triple = null;
	return lines.map((line) => {
		let text = line.text;
		if (triple !== null) {
			const end = text.indexOf(triple);
			if (end === -1) return { ...line, text: "" };
			text = text.slice(end + 3);
			triple = null;
		}
		const tripleMatch = /(?:"""|''')/.exec(text);
		if (tripleMatch !== null) {
			const marker = tripleMatch[0];
			const end = text.indexOf(marker, tripleMatch.index + 3);
			if (end === -1) {
				triple = marker;
				text = text.slice(0, tripleMatch.index);
			} else {
				text = `${text.slice(0, tripleMatch.index)} ${text.slice(end + 3)}`;
			}
		}
		let quote = null;
		let escaped = false;
		for (let index = 0; index < text.length; index += 1) {
			const current = text[index];
			if (quote !== null) {
				if (escaped) escaped = false;
				else if (current === "\\") escaped = true;
				else if (current === quote) quote = null;
				continue;
			}
			if (current === '"' || current === "'") quote = current;
			else if (current === "#") return { ...line, text: text.slice(0, index) };
		}
		return { ...line, text };
	});
}

function isCodePosition(text, position) {
	let quote = null;
	let escaped = false;
	for (let index = 0; index < position; index += 1) {
		const current = text[index];
		if (quote !== null) {
			if (escaped) escaped = false;
			else if (current === "\\") escaped = true;
			else if (current === quote) quote = null;
		} else if (current === '"' || current === "'") {
			quote = current;
		}
	}
	return quote === null;
}
