export function analysisResult(language, values = {}) {
	return Object.freeze({
		language,
		facts: Object.freeze(values.facts ?? []),
		references: Object.freeze(values.references ?? []),
		issues: Object.freeze(values.issues ?? []),
	});
}

export function fact(kind, value, path, line, options = {}) {
	return Object.freeze({
		kind,
		value,
		path,
		line,
		confidence: options.confidence ?? "high",
		operation: options.operation ?? null,
		dynamic: options.dynamic ?? false,
		excerpt: options.excerpt ?? null,
	});
}

export function reference(kind, value, path, line, options = {}) {
	return Object.freeze({
		kind,
		value,
		path,
		line,
		dynamic: options.dynamic ?? false,
		confidence: options.confidence ?? "high",
	});
}

export function analyzerIssue(code, message, path, line = null, options = {}) {
	return Object.freeze({
		code,
		message,
		path,
		line,
		affectsCompleteness: options.affectsCompleteness ?? true,
		limit: options.limit ?? null,
	});
}

export function boundedPush(
	target,
	value,
	limit,
	issues,
	context,
	issueLimit = Number.POSITIVE_INFINITY,
) {
	if (target.length < limit) {
		target.push(value);
		return true;
	}
	if (
		issues.length < issueLimit &&
		!issues.some((entry) => entry.code === context.code)
	) {
		issues.push(
			analyzerIssue(
				context.code,
				context.message,
				context.path,
				context.line ?? null,
				{ limit: context.limit },
			),
		);
	}
	return false;
}
