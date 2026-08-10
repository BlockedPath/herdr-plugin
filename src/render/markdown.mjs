export function renderMarkdown(receipt) {
	const lines = [
		`# Herdr X-Ray: ${escape(receipt.subject.plugin.id)}`,
		"",
		`- Source: \`${escape(receipt.subject.source.display)}\``,
		`- Complete: **${receipt.completeness.complete ? "yes" : "no"}**`,
		`- Facts: ${receipt.summary.facts}; heuristics: ${receipt.summary.heuristics}; unknowns: ${receipt.summary.unknowns}`,
		"",
		"## Execution surface",
		"",
	];
	for (const node of receipt.graph.nodes.filter(
		(entry) => entry.type === "trigger",
	)) {
		lines.push(
			`- \`${escape(node.label)}\` — ${node.effectivePlatforms.join(", ")}`,
		);
	}
	if (receipt.comparison !== null) {
		lines.push("", "## Changes since the installed version", "");
		if (receipt.comparison.changes.length === 0) {
			lines.push("No execution-surface changes were observed.");
		}
		for (const entry of receipt.comparison.changes) {
			lines.push(
				`- **${entry.severity}** — ${entry.change} ${entry.kind}: ${escape(entry.subject)}`,
			);
		}
		lines.push(
			"",
			`Baseline analysis hash: \`${receipt.comparison.baselineAnalysisHash}\``,
		);
	}
	lines.push("", "## Findings", "");
	if (receipt.findings.length === 0) lines.push("None.");
	for (const finding of receipt.findings) {
		lines.push(
			`- **${finding.class}/${finding.severity}** — ${escape(finding.title)} (\`${finding.ruleId}\`)`,
		);
	}
	lines.push("", `Analysis hash: \`${receipt.analysisHash}\``);
	return `${lines.join("\n")}\n`;
}

function escape(value) {
	return String(value)
		.replaceAll(/\p{C}/gu, "�")
		.replaceAll("\\", "\\\\")
		.replaceAll("`", "\\`")
		.replaceAll(
			/[<>&]/g,
			(character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[character],
		);
}
