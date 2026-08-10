import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, resolve, win32 } from "node:path";

const CONTROL_PATTERN = /\p{C}/u;
const GITHUB_PART_PATTERN = /^[A-Za-z0-9_.-]+$/;

export class InputError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "InputError";
		this.code = code;
	}
}

export async function resolveInput(raw, options = {}) {
	const cwd = options.cwd ?? process.cwd();
	const requestedRef = options.ref ?? null;
	validateRawInput(raw);

	if (raw.startsWith("https://") || raw.startsWith("http://")) {
		return resolveGitHubUrl(raw, requestedRef);
	}

	const localCandidate = resolve(cwd, raw);
	const localStat = await tryLstat(localCandidate);
	if (localStat !== null) {
		if (!localStat.isDirectory()) {
			throw new InputError(
				"local-not-directory",
				"local source must be a directory",
			);
		}
		if (requestedRef !== null) {
			throw new InputError(
				"local-ref",
				"--ref is valid only for GitHub sources",
			);
		}
		return {
			kind: "local",
			root: await realpath(localCandidate),
			display: raw,
		};
	}

	if (looksExplicitlyLocal(raw)) {
		throw new InputError(
			"local-not-found",
			`local source does not exist: ${raw}`,
		);
	}
	return resolveGitHubShorthand(raw, requestedRef);
}

function resolveGitHubUrl(raw, requestedRef) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new InputError("invalid-url", "source URL is invalid");
	}
	if (
		url.protocol !== "https:" ||
		url.hostname !== "github.com" ||
		url.username !== "" ||
		url.password !== "" ||
		url.port !== "" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new InputError(
			"unsupported-url",
			"GitHub URL must use exact HTTPS origin without credentials, port, query, or fragment",
		);
	}
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments.length !== 2) {
		throw new InputError(
			"unsupported-github-path",
			"GitHub URLs must point to a repository root; use shorthand for a plugin subdirectory",
		);
	}
	segments[1] = segments[1].replace(/\.git$/i, "");
	return githubInput(segments[0], segments[1], null, requestedRef);
}

function resolveGitHubShorthand(raw, requestedRef) {
	if (raw.includes("\\")) {
		throw new InputError(
			"invalid-github-path",
			"GitHub shorthand must use forward slashes",
		);
	}
	const segments = raw.split("/");
	if (segments.length < 2 || segments.some((segment) => segment.length === 0)) {
		throw new InputError(
			"invalid-source",
			"source must be an existing local directory or owner/repo[/subdir]",
		);
	}
	return githubInput(
		segments[0],
		segments[1],
		segments.length === 2 ? null : segments.slice(2).join("/"),
		requestedRef,
	);
}

function githubInput(owner, repo, subdir, requestedRef) {
	validateGitHubPart(owner, "owner", 100);
	validateGitHubPart(repo, "repository", 100);
	if (subdir !== null) {
		if (subdir.length > 1024) {
			throw new InputError(
				"subdir-too-long",
				"GitHub subdirectory exceeds 1024 characters",
			);
		}
		for (const segment of subdir.split("/")) {
			if (
				segment === "." ||
				segment === ".." ||
				!GITHUB_PART_PATTERN.test(segment)
			) {
				throw new InputError(
					"invalid-subdir",
					"GitHub subdirectory contains an invalid segment",
				);
			}
		}
	}
	const ref = requestedRef ?? "HEAD";
	if (
		typeof ref !== "string" ||
		ref.length === 0 ||
		ref.length > 512 ||
		CONTROL_PATTERN.test(ref) ||
		ref.startsWith("-") ||
		ref === "." ||
		ref === ".."
	) {
		throw new InputError(
			"invalid-ref",
			"GitHub ref is empty, unsafe, or exceeds 512 characters",
		);
	}
	return {
		kind: "github",
		owner,
		repo,
		subdir,
		requestedRef: ref,
		display: `${owner}/${repo}${subdir === null ? "" : `/${subdir}`}`,
	};
}

function validateGitHubPart(value, label, maxLength) {
	if (
		value.length === 0 ||
		value.length > maxLength ||
		value === "." ||
		value === ".." ||
		!GITHUB_PART_PATTERN.test(value)
	) {
		throw new InputError(`invalid-${label}`, `GitHub ${label} is invalid`);
	}
}

function validateRawInput(raw) {
	if (typeof raw !== "string" || raw.length === 0) {
		throw new InputError("empty-source", "source is required");
	}
	if (raw.length > 2048 || CONTROL_PATTERN.test(raw)) {
		throw new InputError(
			"unsafe-source",
			"source contains control characters or is too long",
		);
	}
}

function looksExplicitlyLocal(raw) {
	return (
		raw === "." ||
		raw === ".." ||
		raw.startsWith("./") ||
		raw.startsWith("../") ||
		raw.startsWith("~/") ||
		isAbsolute(raw) ||
		win32.isAbsolute(raw)
	);
}

async function tryLstat(path) {
	try {
		return await lstat(path);
	} catch (error) {
		if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
			return null;
		}
		throw error;
	}
}
