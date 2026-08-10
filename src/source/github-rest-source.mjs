import { resolveLimits } from "../config/limits.mjs";
import { normalizeSourcePath, SourceError } from "./filesystem-source.mjs";

const API_ORIGIN = "https://api.github.com";
const SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const CONTROL_PATTERN = /\p{C}/u;

export class GitHubRestSource {
	static async open(input, options = {}) {
		if (input?.kind !== "github") {
			throw new SourceError(
				"invalid-github-input",
				"GitHub source requires normalized GitHub input",
			);
		}
		const source = new GitHubRestSource(input, options);
		await source.#initialize();
		return source;
	}

	constructor(input, options = {}) {
		this.kind = "github";
		this.owner = input.owner;
		this.repo = input.repo;
		this.subdir = input.subdir;
		this.requestedRef = input.requestedRef;
		this.fetch = options.fetch ?? globalThis.fetch;
		if (typeof this.fetch !== "function") {
			throw new SourceError(
				"fetch-unavailable",
				"Node.js fetch is unavailable",
			);
		}
		this.limits = resolveLimits(options.limits);
		this.externalSignal = options.signal ?? null;
		this.deadlineAt = Date.now() + this.limits.timeoutMs;
		this.requestCount = 0;
		this.blobCount = 0;
		this.totalResponseBytes = 0;
		this.resolvedCommit = null;
		this.treeSha = null;
		this.entries = [];
		this.entryByPath = new Map();
		this.issues = [];
	}

	async #initialize() {
		const commit = await this.#requestJson(
			`/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/commits/${encodeURIComponent(this.requestedRef)}`,
			this.limits.githubCommitResponseBytes,
			"commit",
		);
		if (!SHA_PATTERN.test(commit?.sha ?? "")) {
			throw new SourceError(
				"invalid-commit",
				"GitHub commit response did not contain a valid SHA",
			);
		}
		if (!SHA_PATTERN.test(commit?.commit?.tree?.sha ?? "")) {
			throw new SourceError(
				"invalid-tree",
				"GitHub commit response did not contain a valid tree SHA",
			);
		}
		this.resolvedCommit = commit.sha;
		this.treeSha = commit.commit.tree.sha;

		const tree = await this.#requestJson(
			`/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/trees/${this.treeSha}?recursive=1`,
			this.limits.githubTreeResponseBytes,
			"tree",
		);
		if (!Array.isArray(tree?.tree)) {
			throw new SourceError(
				"invalid-tree",
				"GitHub tree response did not contain an entry array",
			);
		}
		if (tree.truncated === true) {
			this.issues.push(
				Object.freeze({
					code: "tree-truncated",
					message: "GitHub returned a truncated recursive tree",
				}),
			);
		}

		const normalizedEntries = [];
		for (const entry of tree.tree) {
			const normalized = this.#normalizeTreeEntry(entry);
			if (normalized !== null) normalizedEntries.push(normalized);
		}
		normalizedEntries.sort((left, right) =>
			compareNames(left.path, right.path),
		);
		if (normalizedEntries.length > this.limits.filesEnumerated) {
			this.issues.push(
				Object.freeze({
					code: "file-count-limit",
					message: `tree contains ${normalizedEntries.length} entries; retained ${this.limits.filesEnumerated}`,
					limit: this.limits.filesEnumerated,
				}),
			);
			normalizedEntries.length = this.limits.filesEnumerated;
		}
		this.entries = Object.freeze(normalizedEntries);
		this.entryByPath = new Map(
			this.entries.map((entry) => [entry.path, entry]),
		);
		this.issues = Object.freeze([...this.issues]);
	}

	listEntries() {
		return this.entries;
	}

	async readFile(relativePath, options = {}) {
		const path = normalizeSourcePath(relativePath, { windows: false });
		const entry = this.entryByPath.get(path);
		if (entry === undefined) {
			throw new SourceError(
				"missing-file",
				`file is not present in resolved GitHub tree: ${path}`,
			);
		}
		if (entry.type !== "file") {
			throw new SourceError(
				"not-regular",
				`GitHub tree entry is not a file: ${path}`,
			);
		}
		const requestedMax = options.maxBytes ?? this.limits.singleTextFileBytes;
		if (!Number.isSafeInteger(requestedMax) || requestedMax < 0) {
			throw new SourceError(
				"invalid-limit",
				"file byte limit must be a non-negative integer",
			);
		}
		const maxBytes = Math.min(requestedMax, this.limits.githubBlobDecodedBytes);
		if (entry.size !== null && entry.size > maxBytes) {
			throw new SourceError(
				"file-limit",
				`GitHub blob exceeds ${maxBytes} bytes: ${path}`,
				{
					limit: maxBytes,
					size: entry.size,
				},
			);
		}

		if (this.blobCount >= this.limits.githubBlobs) {
			throw new SourceError(
				"blob-count-limit",
				"GitHub blob budget exhausted",
				{
					limit: this.limits.githubBlobs,
				},
			);
		}
		this.blobCount += 1;
		const payload = await this.#requestJson(
			`/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/blobs/${entry.sha}`,
			this.limits.githubBlobResponseBytes,
			"blob",
		);
		if (
			payload?.sha !== entry.sha ||
			payload?.encoding !== "base64" ||
			typeof payload?.content !== "string"
		) {
			throw new SourceError(
				"invalid-blob",
				`GitHub returned invalid blob metadata: ${path}`,
			);
		}
		if (!Number.isSafeInteger(payload.size) || payload.size < 0) {
			throw new SourceError(
				"invalid-blob",
				`GitHub blob size metadata is invalid: ${path}`,
			);
		}
		const encoded = payload.content.replaceAll(/\s/g, "");
		if (!hasBase64Shape(encoded)) {
			throw new SourceError(
				"invalid-base64",
				`GitHub blob is not valid base64: ${path}`,
			);
		}
		const estimatedBytes = Math.floor((encoded.length * 3) / 4);
		if (estimatedBytes > maxBytes + 2) {
			throw new SourceError(
				"file-limit",
				`GitHub blob exceeds ${maxBytes} decoded bytes: ${path}`,
			);
		}
		const bytes = Buffer.from(encoded, "base64");
		if (bytes.toString("base64") !== encoded) {
			throw new SourceError(
				"invalid-base64",
				`GitHub blob is not canonical base64: ${path}`,
			);
		}
		if (bytes.length > maxBytes) {
			throw new SourceError(
				"file-limit",
				`GitHub blob exceeds ${maxBytes} decoded bytes: ${path}`,
			);
		}
		if (
			(Number.isSafeInteger(payload.size) && payload.size !== bytes.length) ||
			(entry.size !== null && entry.size !== bytes.length)
		) {
			throw new SourceError(
				"blob-size-mismatch",
				`GitHub blob size did not match tree metadata: ${path}`,
			);
		}
		return Object.freeze({ path, bytes, size: bytes.length, sha: entry.sha });
	}

	#normalizeTreeEntry(entry) {
		if (
			typeof entry?.path !== "string" ||
			entry.path.length === 0 ||
			entry.path.length > 2048 ||
			CONTROL_PATTERN.test(entry.path) ||
			!SHA_PATTERN.test(entry?.sha ?? "")
		) {
			this.issues.push(
				Object.freeze({
					code: "unsafe-tree-entry",
					message: "GitHub tree contained an invalid path or object ID",
				}),
			);
			return null;
		}
		const prefix = this.subdir === null ? "" : `${this.subdir}/`;
		if (prefix !== "" && !entry.path.startsWith(prefix)) return null;
		const relativePath =
			prefix === "" ? entry.path : entry.path.slice(prefix.length);
		if (relativePath === "") return null;
		let path;
		try {
			path = normalizeSourcePath(relativePath, { windows: false });
		} catch {
			this.issues.push(
				Object.freeze({
					code: "unsafe-tree-entry",
					message:
						"GitHub tree contained a path outside the plugin subdirectory",
				}),
			);
			return null;
		}
		const type = treeEntryType(entry.type);
		const size =
			Number.isSafeInteger(entry.size) && entry.size >= 0 ? entry.size : null;
		return Object.freeze({ path, type, size, sha: entry.sha });
	}

	async #requestJson(path, responseLimit, operation) {
		if (this.requestCount >= this.limits.githubRequests) {
			throw new SourceError(
				"request-limit",
				"GitHub request budget exhausted",
				{
					limit: this.limits.githubRequests,
				},
			);
		}
		this.requestCount += 1;
		const url = new URL(path, API_ORIGIN);
		if (url.origin !== API_ORIGIN) {
			throw new SourceError("origin", "refusing non-GitHub API origin");
		}
		const request = await this.#fetchWithDeadline(url);
		const { response, signal } = request;
		try {
			if (!hasAllowedResponseOrigin(response.url)) {
				cancelResponseBody(response);
				throw new SourceError("origin", "GitHub response changed origin");
			}
			if (response.status >= 300 && response.status < 400) {
				cancelResponseBody(response);
				throw new SourceError("redirect", "GitHub API redirects are refused");
			}
			if (!response.ok) {
				await this.#readBody(
					response,
					this.limits.githubErrorResponseBytes,
					signal,
				);
				throw new SourceError(
					"github-http",
					`GitHub ${operation} request failed with HTTP ${response.status}`,
					{
						status: response.status,
					},
				);
			}
			const body = await this.#readBody(response, responseLimit, signal);
			try {
				return JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(body),
				);
			} catch (error) {
				throw new SourceError(
					"invalid-json",
					`GitHub ${operation} response was not valid UTF-8 JSON`,
					{
						cause: error instanceof Error ? error.message : String(error),
					},
				);
			}
		} finally {
			request.cleanup();
		}
	}

	async #fetchWithDeadline(url) {
		const remaining = this.deadlineAt - Date.now();
		if (remaining <= 0) {
			throw new SourceError("timeout", "GitHub acquisition deadline expired");
		}
		const controller = new AbortController();
		const abortFromParent = () => controller.abort();
		let cleaned = false;
		const cleanup = () => {
			if (cleaned) return;
			cleaned = true;
			clearTimeout(timeout);
			this.externalSignal?.removeEventListener("abort", abortFromParent);
		};
		const timeout = setTimeout(() => controller.abort(), remaining);
		if (this.externalSignal?.aborted === true) controller.abort();
		this.externalSignal?.addEventListener("abort", abortFromParent, {
			once: true,
		});
		try {
			const response = await this.fetch(url, {
				method: "GET",
				redirect: "manual",
				signal: controller.signal,
				headers: {
					Accept: "application/vnd.github+json",
					"User-Agent": "herdr-xray",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			});
			return { response, signal: controller.signal, cleanup };
		} catch (error) {
			cleanup();
			if (controller.signal.aborted) {
				throw new SourceError(
					"timeout",
					"GitHub request was aborted or timed out",
				);
			}
			throw error;
		}
	}

	async #readBody(response, responseLimit, signal) {
		const declaredLength = parseContentLength(
			response.headers?.get?.("content-length"),
		);
		const remainingTotal =
			this.limits.githubTotalResponseBytes - this.totalResponseBytes;
		if (
			declaredLength !== null &&
			(declaredLength > responseLimit || declaredLength > remainingTotal)
		) {
			cancelResponseBody(response);
			throw new SourceError(
				"response-limit",
				"GitHub response exceeds byte budget",
			);
		}
		if (response.body === null || response.body === undefined)
			return Buffer.alloc(0);

		const reader = response.body.getReader();
		const chunks = [];
		let responseBytes = 0;
		try {
			while (true) {
				const { done, value } = await readWithSignal(reader, signal);
				if (done) break;
				responseBytes += value.byteLength;
				this.totalResponseBytes += value.byteLength;
				if (
					responseBytes > responseLimit ||
					this.totalResponseBytes > this.limits.githubTotalResponseBytes
				) {
					void reader.cancel().catch(() => {});
					throw new SourceError(
						"response-limit",
						"GitHub response exceeds byte budget",
					);
				}
				chunks.push(Buffer.from(value));
			}
		} finally {
			try {
				reader.releaseLock();
			} catch {
				// An aborted read can retain the lock until its underlying stream settles.
			}
		}
		return Buffer.concat(chunks, responseBytes);
	}
}

function cancelResponseBody(response) {
	void response.body?.cancel?.().catch(() => {});
}

function hasAllowedResponseOrigin(value) {
	if (value === "") return true;
	try {
		return new URL(value).origin === API_ORIGIN;
	} catch {
		return false;
	}
}

function readWithSignal(reader, signal) {
	if (signal.aborted) {
		return Promise.reject(
			new SourceError("timeout", "GitHub response body timed out"),
		);
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			callback(value);
		};
		const onAbort = () => {
			void reader.cancel().catch(() => {});
			finish(
				reject,
				new SourceError("timeout", "GitHub response body timed out"),
			);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		reader.read().then(
			(value) => finish(resolve, value),
			(error) => finish(reject, error),
		);
	});
}

function treeEntryType(type) {
	if (type === "blob") return "file";
	if (type === "tree") return "directory";
	if (type === "commit") return "submodule";
	return "other";
}

function hasBase64Shape(value) {
	return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function parseContentLength(value) {
	if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function compareNames(left, right) {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}
