import { createCollector } from "./collector.mjs";
import { recordEnvironment, scanCommon } from "./common.mjs";
import { boundedLines, decodeText } from "./text.mjs";

const ENV_PATTERN =
	/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
const SOURCE_PATTERN = /^\s*(?:source|\.)\s+["']?([^\s"']+)/;
const SCRIPT_PATTERN = /^\s*(?:bash|sh|zsh|fish)\s+["']?([^\s"']+)/;
const REDIRECT_PATTERN = /(?:>>|>|tee\s+)\s*["']?([^\s"'|;&]+)/g;

export function analyzeShell(path, bytes, limits) {
	const decoded = decodeText(bytes, path);
	if (typeof decoded !== "string")
		return createCollector("shell", path, limits, [decoded.error]).result();
	const bounded = boundedLines(decoded, path, limits);
	const collector = createCollector("shell", path, limits, bounded.issues);
	const scannedLines = bounded.lines.map((line) => ({
		...line,
		text: stripShellComment(line.text),
	}));
	scanCommon(scannedLines, collector);
	for (const line of scannedLines) {
		for (const match of line.text.matchAll(ENV_PATTERN))
			recordEnvironment(match[1] ?? match[2], line.number, collector);
		const sourced = SOURCE_PATTERN.exec(line.text);
		if (sourced !== null)
			collector.reference("source", sourced[1], line.number);
		const script = SCRIPT_PATTERN.exec(line.text);
		if (script !== null && script[1] !== "-c")
			collector.reference("spawn-script", script[1], line.number);
		for (const match of line.text.matchAll(REDIRECT_PATTERN)) {
			collector.fact("filesystem-write", match[1], line.number, {
				operation: "write",
				excerpt: match[0],
			});
		}
		if (/\beval\b|\b(?:bash|sh)\s+-c\b/.test(line.text)) {
			collector.fact("shell-eval", "inline shell evaluation", line.number, {
				dynamic: true,
				excerpt: line.text,
				confidence: "medium",
			});
		}
		if (/\$\(|`[^`]+`/.test(line.text)) {
			collector.fact(
				"dynamic-subprocess",
				"command substitution",
				line.number,
				{ dynamic: true, confidence: "medium" },
			);
			collector.issue(
				"dynamic-subprocess",
				"shell command substitution is dynamic",
				line.number,
			);
		}
		if (
			/\b(?:curl|wget)\b[^|;&\n]*(?:\$\{?[A-Za-z_]|\$[A-Za-z_])/.test(line.text)
		) {
			collector.fact("dynamic-endpoint", "<computed>", line.number, {
				dynamic: true,
				confidence: "medium",
			});
			collector.issue(
				"dynamic-endpoint",
				"shell network destination is computed",
				line.number,
			);
		}
		if (/(?:curl|wget)\b.*\|\s*(?:bash|sh)\b/.test(line.text)) {
			collector.fact(
				"download-to-shell",
				"download piped to shell",
				line.number,
				{ excerpt: line.text, confidence: "medium" },
			);
		}
	}
	return collector.result();
}

function stripShellComment(text) {
	let quote = null;
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		const current = text[index];
		if (quote !== null) {
			if (escaped) escaped = false;
			else if (current === "\\" && quote !== "'") escaped = true;
			else if (current === quote) quote = null;
			continue;
		}
		if (current === '"' || current === "'") quote = current;
		else if (current === "#" && (index === 0 || /\s/.test(text[index - 1]))) {
			return text.slice(0, index);
		}
	}
	return text;
}
