import { sha256Value } from "../receipt/hash.mjs";
import { RULES } from "./registry.mjs";

const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export function createFinding(
	ruleId,
	title,
	explanation,
	subject,
	evidence = {},
) {
	const rule = RULE_BY_ID.get(ruleId);
	if (rule === undefined) {
		throw new Error(`missing rule registration: ${ruleId}`);
	}
	return Object.freeze({
		id: `finding:${sha256Value([ruleId, subject]).slice(7, 31)}`,
		ruleId,
		class: rule.classification,
		severity: rule.severity,
		confidence: evidence.confidence ?? "high",
		category: rule.category,
		title: String(title).slice(0, 256),
		explanation: String(explanation).slice(0, 2048),
		evidence: [
			{
				path: evidence.path ?? "herdr-plugin.toml",
				line: evidence.line ?? null,
				column: null,
				excerpt: evidence.excerpt ?? null,
			},
		],
		remediation:
			evidence.remediation ??
			"Review the referenced manifest declaration and reachable source before installation.",
	});
}
