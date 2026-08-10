export function renderTerminal(receipt) {
	const lines = [
		`Herdr X-Ray — ${safe(receipt.subject.plugin.id)} ${safe(receipt.subject.plugin.version)}`,
		`Source: ${safe(receipt.subject.source.display)}`,
		`Complete: ${receipt.completeness.complete ? "yes" : "no"}`,
		`Findings: ${receipt.summary.facts} facts, ${receipt.summary.heuristics} heuristics, ${receipt.summary.unknowns} unknowns`,
		"",
		"Execution surface",
	];
	for (const node of receipt.graph.nodes.filter(
		(entry) => entry.type === "trigger",
	)) {
		lines.push(`- ${safe(node.label)} [${node.effectivePlatforms.join(", ")}]`);
	}
	lines.push("", "Findings");
	if (receipt.findings.length === 0) lines.push("- none");
	for (const finding of receipt.findings) {
		lines.push(
			`- ${finding.class}/${finding.severity}: ${safe(finding.title)} (${finding.ruleId})`,
		);
	}
	lines.push("", `Analysis hash: ${receipt.analysisHash}`);
	return `${lines.join("\n")}\n`;
}

function safe(value) {
	return String(value)
		.replaceAll(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "")
		.replaceAll(/[\p{Cc}\p{Cf}]/gu, "�");
}
