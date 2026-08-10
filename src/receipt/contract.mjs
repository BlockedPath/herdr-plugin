export const CORE_COMPLETENESS_DIMENSIONS = Object.freeze([
	"source",
	"manifest",
	"executionGraph",
	"reachableSource",
	"analysis",
	"cleanup",
]);

export const OPTIONAL_COMPLETENESS_DIMENSIONS = Object.freeze([
	"marketplace",
	"comparison",
]);

const SHA_PATTERN = /^[0-9a-f]{40,64}$/;

export function validateReceiptContract(receipt) {
	const errors = [];
	if (!isRecord(receipt)) {
		return ["receipt must be an object"];
	}

	requireKeys(
		receipt,
		[
			"schemaVersion",
			"tool",
			"generatedAt",
			"subject",
			"limits",
			"completeness",
			"summary",
			"graph",
			"findings",
			"comparison",
			"provenance",
			"analysisHash",
			"receiptHash",
		],
		"receipt",
		errors,
	);

	const subject = receipt.subject;
	const source = isRecord(subject) ? subject.source : undefined;
	validateSource(source, errors);

	const completeness = receipt.completeness;
	const dimensions = isRecord(completeness)
		? completeness.dimensions
		: undefined;
	if (!isRecord(dimensions)) {
		errors.push("completeness.dimensions must be an object");
	} else {
		requireKeys(
			dimensions,
			CORE_COMPLETENESS_DIMENSIONS,
			"completeness.dimensions",
			errors,
		);
		for (const name of Object.keys(dimensions)) {
			if (
				!CORE_COMPLETENESS_DIMENSIONS.includes(name) &&
				!OPTIONAL_COMPLETENESS_DIMENSIONS.includes(name)
			) {
				errors.push(`completeness.dimensions has an unknown dimension ${name}`);
				continue;
			}
			validateCompletenessStatus(dimensions[name], name, errors);
		}
	}

	if (isRecord(completeness) && completeness.complete === true) {
		if (!isRecord(subject?.plugin)) {
			errors.push("a complete receipt requires parsed plugin identity");
		}
		if (source?.status !== "resolved") {
			errors.push("a complete receipt requires a resolved source");
		}
		if (completeness.unstable !== false) {
			errors.push("a complete receipt cannot be unstable");
		}
		for (const name of CORE_COMPLETENESS_DIMENSIONS) {
			if (dimensions?.[name]?.status !== "complete") {
				errors.push(`a complete receipt requires ${name} to be complete`);
			}
		}
		const files = receipt.provenance?.files;
		if (
			!Array.isArray(files) ||
			!files.some((file) => file?.role === "manifest")
		) {
			errors.push("a complete receipt requires manifest file provenance");
		}
	}

	return errors;
}

function validateSource(source, errors) {
	if (!isRecord(source)) {
		errors.push("subject.source must be an object");
		return;
	}
	requireKeys(
		source,
		["kind", "status", "display", "resolvedCommit", "localRootHash"],
		"subject.source",
		errors,
	);
	if (source.status !== "resolved" && source.status !== "unresolved") {
		errors.push("subject.source.status must be resolved or unresolved");
	}
	if (source.kind === "github") {
		requireKeys(
			source,
			["owner", "repo", "subdir", "requestedRef", "resolvedCommit"],
			"GitHub source",
			errors,
		);
		if (
			source.status === "resolved" &&
			!SHA_PATTERN.test(source.resolvedCommit ?? "")
		) {
			errors.push("a resolved GitHub source requires a commit SHA");
		}
	}
}

function validateCompletenessStatus(value, name, errors) {
	if (!isRecord(value)) {
		errors.push(`completeness dimension ${name} must be an object`);
		return;
	}
	requireKeys(
		value,
		["status", "reason", "limit"],
		`completeness dimension ${name}`,
		errors,
	);
	if (!["complete", "partial", "unavailable"].includes(value.status)) {
		errors.push(`completeness dimension ${name} has an invalid status`);
	}
	if (value.status === "complete" && value.reason !== null) {
		errors.push(`complete dimension ${name} must have a null reason`);
	}
	if (
		(value.status === "partial" || value.status === "unavailable") &&
		(typeof value.reason !== "string" || value.reason.length === 0)
	) {
		errors.push(`incomplete dimension ${name} requires a reason`);
	}
}

function requireKeys(value, keys, label, errors) {
	for (const key of keys) {
		if (!Object.hasOwn(value, key)) {
			errors.push(`${label} is missing ${key}`);
		}
	}
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
