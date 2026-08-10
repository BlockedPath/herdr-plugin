import { analysisResult, analyzerIssue, fact, reference } from "./model.mjs";
import { excerpt } from "./text.mjs";

export function createCollector(language, path, limits, initialIssues = []) {
	const facts = [];
	const references = [];
	const issues = initialIssues.slice(0, limits.analyzerIssuesPerFile);
	if (initialIssues.length > limits.analyzerIssuesPerFile) addIssueLimit();
	const factKeys = new Set();
	const referenceKeys = new Set();

	function addIssueLimit() {
		if (!issues.some((entry) => entry.code === "issue-limit")) {
			issues.push(
				analyzerIssue(
					"issue-limit",
					"analyzer issue limit reached",
					path,
					null,
					{ limit: "analyzerIssuesPerFile" },
				),
			);
		}
	}

	function addEvidenceLimit(code, message, line, limitName) {
		if (
			issues.length < limits.analyzerIssuesPerFile &&
			!issues.some((entry) => entry.code === code)
		) {
			issues.push(
				analyzerIssue(code, message, path, line, { limit: limitName }),
			);
		} else if (issues.length >= limits.analyzerIssuesPerFile) {
			addIssueLimit();
		}
	}

	return Object.freeze({
		fact(kind, value, line, options = {}) {
			if (facts.length >= limits.analyzerFactsPerFile) {
				addEvidenceLimit(
					"fact-limit",
					"analyzer fact limit reached",
					line,
					"analyzerFactsPerFile",
				);
				return;
			}
			const key = JSON.stringify([
				kind,
				value,
				line,
				options.operation,
				options.dynamic,
			]);
			if (factKeys.has(key)) return;
			factKeys.add(key);
			facts.push(
				fact(kind, value, path, line, {
					...options,
					excerpt:
						options.excerpt === undefined
							? null
							: excerpt(options.excerpt, limits.evidenceExcerptCodeUnits),
				}),
			);
		},
		reference(kind, value, line, options = {}) {
			if (references.length >= limits.referencesPerFile) {
				addEvidenceLimit(
					"reference-limit",
					"analyzer reference limit reached",
					line,
					"referencesPerFile",
				);
				return;
			}
			const key = JSON.stringify([kind, value, line, options.dynamic]);
			if (referenceKeys.has(key)) return;
			referenceKeys.add(key);
			references.push(reference(kind, value, path, line, options));
		},
		issue(code, message, line = null, options = {}) {
			if (issues.length >= limits.analyzerIssuesPerFile) {
				addIssueLimit();
				return;
			}
			issues.push(analyzerIssue(code, message, path, line, options));
		},
		result() {
			return analysisResult(language, { facts, references, issues });
		},
	});
}
