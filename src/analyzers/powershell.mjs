import { createCollector } from "./collector.mjs";
import { recordEnvironment, scanCommon } from "./common.mjs";
import { boundedLines, decodeText } from "./text.mjs";

const ENV = /\$env:([A-Za-z_][A-Za-z0-9_]*)/gi;
const SCRIPT = /^\s*(?:&|\.)\s*["']?([^\s"']+\.ps1)/i;

export function analyzePowerShell(path, bytes, limits) {
	const decoded = decodeText(bytes, path);
	if (typeof decoded !== "string")
		return createCollector("powershell", path, limits, [
			decoded.error,
		]).result();
	const bounded = boundedLines(decoded, path, limits);
	const collector = createCollector("powershell", path, limits, bounded.issues);
	const scannedLines = stripPowerShellComments(bounded.lines);
	scanCommon(scannedLines, collector);
	for (const line of scannedLines) {
		for (const match of line.text.matchAll(ENV))
			recordEnvironment(match[1], line.number, collector);
		const script = SCRIPT.exec(line.text);
		if (script !== null)
			collector.reference("spawn-script", script[1], line.number);
		if (/\b(?:Invoke-Expression|iex)\b/i.test(line.text)) {
			collector.fact("dynamic-code", "Invoke-Expression", line.number, {
				dynamic: true,
			});
			collector.issue(
				"dynamic-code",
				"PowerShell dynamic evaluation is present",
				line.number,
			);
		}
		if (/\bStart-Process\b/i.test(line.text)) {
			const literal = /\bStart-Process\s+["']([^"']+)["']/i.exec(
				line.text,
			)?.[1];
			if (literal === undefined)
				collector.issue(
					"dynamic-subprocess",
					"PowerShell process target is computed",
					line.number,
				);
			else
				collector.fact("subprocess", literal, line.number, {
					operation: "spawn",
					excerpt: literal,
				});
		}
		if (
			/\b(?:Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*(?:-Uri\s+)?\$[A-Za-z_]/i.test(
				line.text,
			)
		) {
			collector.fact("dynamic-endpoint", "<computed>", line.number, {
				dynamic: true,
				confidence: "medium",
			});
			collector.issue(
				"dynamic-endpoint",
				"PowerShell network destination is computed",
				line.number,
			);
		}
		if (
			/\b(?:Set-Content|Add-Content|Out-File|Remove-Item|New-Item)\b/i.test(
				line.text,
			)
		) {
			collector.fact("filesystem-write", "<PowerShell path>", line.number, {
				operation: "write",
				excerpt: line.text,
			});
		}
	}
	return collector.result();
}

function stripPowerShellComments(lines) {
	let inBlock = false;
	return lines.map((line) => {
		let output = "";
		let quote = null;
		for (let index = 0; index < line.text.length; index += 1) {
			const current = line.text[index];
			const next = line.text[index + 1];
			if (inBlock) {
				if (current === "#" && next === ">") {
					inBlock = false;
					index += 1;
				}
				continue;
			}
			if (quote !== null) {
				output += current;
				if (current === quote) quote = null;
				continue;
			}
			if (current === '"' || current === "'") {
				quote = current;
				output += current;
			} else if (current === "<" && next === "#") {
				inBlock = true;
				index += 1;
			} else if (current === "#") {
				break;
			} else {
				output += current;
			}
		}
		return { ...line, text: output };
	});
}
