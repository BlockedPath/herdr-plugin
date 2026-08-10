export const DEFAULT_LIMITS = Object.freeze({
	timeoutMs: 60_000,
	githubRequests: 48,
	githubTotalResponseBytes: 24 * 1024 * 1024,
	githubCommitResponseBytes: 1024 * 1024,
	githubTreeResponseBytes: 8 * 1024 * 1024,
	githubBlobResponseBytes: 2 * 1024 * 1024,
	githubBlobDecodedBytes: 1024 * 1024,
	githubErrorResponseBytes: 64 * 1024,
	githubBlobs: 40,
	filesEnumerated: 10_000,
	filesAnalyzed: 2_000,
	totalAnalysisBytes: 20 * 1024 * 1024,
	manifestBytes: 1024 * 1024,
	tomlDepth: 64,
	singleTextFileBytes: 1024 * 1024,
	singleBinaryHashBytes: 20 * 1024 * 1024,
	singleLineBytes: 64 * 1024,
	linesPerFile: 20_000,
	analyzerFactsPerFile: 500,
	analyzerIssuesPerFile: 500,
	referencesPerFile: 500,
	traceDepth: 4,
	graphNodes: 2_000,
	graphEdges: 5_000,
	findings: 1_000,
	diagnosticBytes: 64 * 1024,
	evidenceExcerptCodeUnits: 160,
	marketplaceResponseBytes: 16 * 1024 * 1024,
	httpRedirects: 0,
});

export const HARD_LIMITS = Object.freeze({
	timeoutMs: 300_000,
	githubRequests: 128,
	githubTotalResponseBytes: 96 * 1024 * 1024,
	githubCommitResponseBytes: 2 * 1024 * 1024,
	githubTreeResponseBytes: 8 * 1024 * 1024,
	githubBlobResponseBytes: 8 * 1024 * 1024,
	githubBlobDecodedBytes: 5 * 1024 * 1024,
	githubErrorResponseBytes: 256 * 1024,
	githubBlobs: 120,
	filesEnumerated: 50_000,
	filesAnalyzed: 10_000,
	totalAnalysisBytes: 100 * 1024 * 1024,
	manifestBytes: 2 * 1024 * 1024,
	tomlDepth: 128,
	singleTextFileBytes: 5 * 1024 * 1024,
	singleBinaryHashBytes: 100 * 1024 * 1024,
	singleLineBytes: 256 * 1024,
	linesPerFile: 100_000,
	analyzerFactsPerFile: 2_000,
	analyzerIssuesPerFile: 2_000,
	referencesPerFile: 2_000,
	traceDepth: 8,
	graphNodes: 10_000,
	graphEdges: 25_000,
	findings: 5_000,
	diagnosticBytes: 256 * 1024,
	evidenceExcerptCodeUnits: 512,
	marketplaceResponseBytes: 32 * 1024 * 1024,
	httpRedirects: 0,
});

export function resolveLimits(overrides = {}) {
	if (
		overrides === null ||
		typeof overrides !== "object" ||
		Array.isArray(overrides)
	) {
		throw new TypeError("limit overrides must be an object");
	}
	const resolved = { ...DEFAULT_LIMITS };
	for (const [name, value] of Object.entries(overrides)) {
		if (!Object.hasOwn(HARD_LIMITS, name)) {
			throw new RangeError(`unknown resource limit: ${name}`);
		}
		if (
			!Number.isSafeInteger(value) ||
			value < 0 ||
			value > HARD_LIMITS[name]
		) {
			throw new RangeError(
				`invalid resource limit ${name}; expected 0..${HARD_LIMITS[name]}`,
			);
		}
		resolved[name] = value;
	}
	return Object.freeze(resolved);
}
