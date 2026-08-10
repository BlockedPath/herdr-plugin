import { resolveLimits } from "../config/limits.mjs";

const MARKETPLACE_URL = "https://herdr.dev/plugins/";
const MARKETPLACE_ORIGIN = "https://herdr.dev";

export class MarketplaceError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "MarketplaceError";
		this.code = code;
		this.details = details;
	}
}

export async function fetchMarketplace(options = {}) {
	const limits = resolveLimits(options.limits ?? {});
	const fetchImpl = options.fetch ?? globalThis.fetch;
	if (typeof fetchImpl !== "function") {
		throw new MarketplaceError(
			"fetch-unavailable",
			"Node.js fetch is unavailable",
		);
	}
	// Use deadline similar to github: if startedAt not provided, use limits.timeoutMs as budget
	const deadlineMs = options.deadlineAt ?? Date.now() + limits.timeoutMs;
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		Math.max(0, deadlineMs - Date.now()),
	);
	if (options.signal?.aborted) controller.abort();
	options.signal?.addEventListener("abort", () => controller.abort(), {
		once: true,
	});
	try {
		const response = await fetchImpl(MARKETPLACE_URL, {
			method: "GET",
			redirect: "manual",
			signal: controller.signal,
			headers: { Accept: "text/html,*/*", "User-Agent": "herdr-xray" },
		});
		if (response.status >= 300 && response.status < 400) {
			cancelBody(response);
			throw new MarketplaceError(
				"redirect",
				"marketplace redirects are not followed",
			);
		}
		if (!response.ok) {
			cancelBody(response);
			throw new MarketplaceError(
				"http",
				`marketplace request failed with HTTP ${response.status}`,
				{ status: response.status },
			);
		}
		if (
			response.url &&
			response.url !== "" &&
			new URL(response.url).origin !== MARKETPLACE_ORIGIN
		) {
			cancelBody(response);
			throw new MarketplaceError(
				"origin",
				"marketplace response changed origin",
			);
		}
		const body = await readBounded(
			response,
			limits.marketplaceResponseBytes,
			controller.signal,
		);
		const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
		const data = extractInitialData(text);
		validateMarketplaceData(data);
		return data;
	} catch (error) {
		if (error instanceof MarketplaceError) throw error;
		if (controller.signal.aborted) {
			throw new MarketplaceError("timeout", "marketplace request timed out");
		}
		throw new MarketplaceError(
			"fetch-failed",
			error instanceof Error ? error.message : String(error),
		);
	} finally {
		clearTimeout(timeout);
	}
}

function cancelBody(response) {
	void response.body?.cancel?.().catch(() => {});
}

async function readBounded(response, limit, signal) {
	const length = parseContentLength(response.headers?.get?.("content-length"));
	if (length !== null && length > limit) {
		cancelBody(response);
		throw new MarketplaceError(
			"response-limit",
			`marketplace response exceeds ${limit} bytes`,
		);
	}
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await readWithSignal(reader, signal);
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				void reader.cancel().catch(() => {});
				throw new MarketplaceError(
					"response-limit",
					`marketplace response exceeds ${limit} bytes`,
				);
			}
			chunks.push(Buffer.from(value));
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {}
	}
	return Buffer.concat(chunks, total);
}

function readWithSignal(reader, signal) {
	if (signal.aborted)
		return Promise.reject(
			new MarketplaceError("timeout", "marketplace timed out"),
		);
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (cb, v) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			cb(v);
		};
		const onAbort = () => {
			void reader.cancel().catch(() => {});
			finish(reject, new MarketplaceError("timeout", "marketplace timed out"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		reader.read().then(
			(v) => finish(resolve, v),
			(e) => finish(reject, e),
		);
	});
}

function parseContentLength(value) {
	if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
	const n = Number(value);
	return Number.isSafeInteger(n) ? n : null;
}

function extractInitialData(html) {
	const marker = "const initialData =";
	const idx = html.indexOf(marker);
	if (idx === -1)
		throw new MarketplaceError(
			"extract-failed",
			"marketplace page did not contain initialData",
		);
	const braceIdx = html.indexOf("{", idx);
	if (braceIdx === -1)
		throw new MarketplaceError(
			"extract-failed",
			"marketplace initialData has no object",
		);
	const { end } = findBalancedBrace(html, braceIdx);
	const jsonText = html.slice(braceIdx, end + 1);
	try {
		return JSON.parse(jsonText);
	} catch (error) {
		throw new MarketplaceError(
			"invalid-json",
			`marketplace initialData is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function findBalancedBrace(text, start) {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return { end: i };
		}
	}
	throw new MarketplaceError(
		"extract-failed",
		"marketplace initialData braces are unbalanced",
	);
}

function validateMarketplaceData(data) {
	if (data === null || typeof data !== "object" || Array.isArray(data))
		throw new MarketplaceError(
			"invalid-data",
			"marketplace data is not an object",
		);
	if (data.schemaVersion !== 1)
		throw new MarketplaceError(
			"unsupported-schema",
			`marketplace schemaVersion is ${data.schemaVersion}`,
		);
	if (!Array.isArray(data.plugins))
		throw new MarketplaceError(
			"invalid-data",
			"marketplace plugins is not an array",
		);
	// Further validation is permissive; collisions logic will ignore malformed entries
}
