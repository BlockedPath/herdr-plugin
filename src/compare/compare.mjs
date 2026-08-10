import { auditInstalled, auditSource } from "../audit/audit.mjs";
import { resolveLimits } from "../config/limits.mjs";
import { finalizeReceipt } from "../receipt/hash.mjs";
import { createFinding } from "../rules/finding.mjs";
import { diffReceipts, upstreamIdentity } from "./diff.mjs";

export async function compareInstalled(pluginId, rawSource, options = {}) {
	const baseline = await auditInstalled(pluginId, {
		...options,
		ref: undefined,
	});
	const candidate = await auditSource(rawSource, options);
	return mergeComparison(baseline, candidate, options);
}

export function mergeComparison(baseline, candidate, options = {}) {
	const limits = resolveLimits(options.limits ?? {});
	if (baseline.subject.plugin === null || candidate.subject.plugin === null) {
		return withComparison(candidate, null, [], {
			status: "unavailable",
			reason: "Plugin identity was not parsed for both sides of the comparison.",
			limit: null,
		});
	}
	const { changes, truncated } = diffReceipts(baseline, candidate, limits);
	const findings = comparisonFindings(baseline, candidate);
	const dimension = truncated
		? {
				status: "partial",
				reason: "The comparison reached the configured change limit.",
				limit: "comparisonChanges",
			}
		: { status: "complete", reason: null, limit: null };
	return withComparison(candidate, baseline, changes, dimension, findings);
}

function withComparison(
	candidate,
	baseline,
	changes,
	dimension,
	extraFindings = [],
) {
	const findings = dedupe([...candidate.findings, ...extraFindings]).sort(
		(left, right) => left.id.localeCompare(right.id),
	);
	const dimensions = { ...candidate.completeness.dimensions, comparison: dimension };
	const complete =
		Object.values(dimensions).every((entry) => entry.status === "complete") &&
		candidate.completeness.unstable === false;
	const receipt = {
		...candidate,
		subject: {
			...candidate.subject,
			installedBaseline:
				baseline === null
					? null
					: {
							source: baseline.subject.source,
							plugin: baseline.subject.plugin,
							analysisHash: baseline.analysisHash,
						},
		},
		completeness: { ...candidate.completeness, complete, dimensions },
		summary: summarize(findings),
		findings,
		comparison:
			baseline === null
				? null
				: { baselineAnalysisHash: baseline.analysisHash, changes },
	};
	return finalizeReceipt(receipt);
}

function comparisonFindings(baseline, candidate) {
	const findings = [];
	const before = baseline.subject;
	const after = candidate.subject;
	const beforeUpstream = upstreamIdentity(baseline);
	const afterUpstream = upstreamIdentity(candidate);
	// Only a verifiable upstream change on both sides is a source change. A local
	// candidate has no upstream identity, which the diff reports as unverifiable
	// rather than as an ownership transfer.
	const upstreamChanged =
		beforeUpstream !== null &&
		afterUpstream !== null &&
		beforeUpstream.display !== afterUpstream.display;
	if (upstreamChanged || before.plugin.id !== after.plugin.id) {
		const beforeLabel = beforeUpstream?.display ?? "<unverifiable>";
		const afterLabel = afterUpstream?.display ?? "<unverifiable>";
		findings.push(
			createFinding(
				"xray.identity.source-changed",
				`Installed and candidate identity differ: ${beforeLabel} -> ${afterLabel}`,
				`The installed plugin ${before.plugin.id} came from ${beforeLabel}; the candidate declares ${after.plugin.id} from ${afterLabel}. Confirm the new source is the one you intend to trust.`,
				`${beforeLabel}|${afterLabel}|${before.plugin.id}|${after.plugin.id}`,
			),
		);
	}
	const beforePlatforms = (before.plugin.platforms ?? []).join(",");
	const afterPlatforms = (after.plugin.platforms ?? []).join(",");
	if (beforePlatforms !== afterPlatforms) {
		findings.push(
			createFinding(
				"xray.identity.platform-changed",
				`Declared platforms changed: ${beforePlatforms || "<none>"} -> ${afterPlatforms || "<none>"}`,
				"The candidate declares a different platform scope than the installed plugin, so it can execute on hosts the installed version did not.",
				`${beforePlatforms}|${afterPlatforms}`,
			),
		);
	}
	if (before.plugin.minHerdrVersion !== after.plugin.minHerdrVersion) {
		findings.push(
			createFinding(
				"xray.identity.herdr-version-changed",
				`Minimum Herdr version changed: ${before.plugin.minHerdrVersion} -> ${after.plugin.minHerdrVersion}`,
				"The candidate requires a different minimum Herdr version than the installed plugin.",
				`${before.plugin.minHerdrVersion}|${after.plugin.minHerdrVersion}`,
			),
		);
	}
	return findings;
}

function dedupe(findings) {
	return [...new Map(findings.map((entry) => [entry.id, entry])).values()];
}

function summarize(findings) {
	const summary = {
		facts: 0,
		heuristics: 0,
		unknowns: 0,
		bySeverity: { info: 0, low: 0, medium: 0, high: 0 },
	};
	for (const entry of findings) {
		if (entry.class === "fact") summary.facts += 1;
		if (entry.class === "heuristic") summary.heuristics += 1;
		if (entry.class === "unknown") summary.unknowns += 1;
		summary.bySeverity[entry.severity] += 1;
	}
	return summary;
}
