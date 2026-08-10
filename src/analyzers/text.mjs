import { analyzerIssue } from "./model.mjs";

export function decodeText(bytes, path) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return {
			error: analyzerIssue(
				"invalid-utf8",
				"reachable text file is not valid UTF-8",
				path,
			),
		};
	}
}

export function boundedLines(source, path, limits) {
	const lines = [];
	const issues = [];
	let start = 0;
	let lineNumber = 1;
	for (let index = 0; index <= source.length; index += 1) {
		if (index !== source.length && source[index] !== "\n") continue;
		if (lines.length >= limits.linesPerFile) {
			addIssue(
				issues,
				limits,
				analyzerIssue(
					"line-count-limit",
					`file exceeds ${limits.linesPerFile} analyzed lines`,
					path,
					lineNumber,
					{ limit: "linesPerFile" },
				),
			);
			break;
		}
		let text = source.slice(start, index);
		if (text.endsWith("\r")) text = text.slice(0, -1);
		const byteLength = Buffer.byteLength(text);
		if (byteLength > limits.singleLineBytes) {
			addIssue(
				issues,
				limits,
				analyzerIssue(
					"line-length-limit",
					`line exceeds ${limits.singleLineBytes} bytes`,
					path,
					lineNumber,
					{ limit: "singleLineBytes" },
				),
			);
			text = text.slice(0, limits.singleLineBytes);
		}
		lines.push(Object.freeze({ number: lineNumber, text }));
		lineNumber += 1;
		start = index + 1;
	}
	return Object.freeze({
		lines: Object.freeze(lines),
		issues: Object.freeze(issues),
	});
}

function addIssue(issues, limits, issue) {
	if (issues.length < limits.analyzerIssuesPerFile) {
		issues.push(issue);
		return;
	}
	if (!issues.some((entry) => entry.code === "issue-limit")) {
		issues.push(
			analyzerIssue(
				"issue-limit",
				"analyzer issue limit reached",
				issue.path,
				issue.line,
				{ limit: "analyzerIssuesPerFile" },
			),
		);
	}
}

export function excerpt(value, limit) {
	const clean = String(value).replaceAll(/[\p{Cc}\p{Cf}]/gu, "�");
	return clean.slice(0, limit);
}
