import assert from "node:assert/strict";
import test from "node:test";

import { GitHubRestSource } from "../src/source/github-rest-source.mjs";
import { SourceError } from "../src/source/filesystem-source.mjs";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const TREE_SHA = "1111111111111111111111111111111111111111";
const MANIFEST_SHA = "2222222222222222222222222222222222222222";
const SCRIPT_SHA = "3333333333333333333333333333333333333333";
const BACKSLASH_SHA = "6666666666666666666666666666666666666666";
const MANIFEST = 'id = "example.plugin"\n';
const SCRIPT = "console.log('not executed')\n";

function input(overrides = {}) {
	return {
		kind: "github",
		owner: "owner",
		repo: "repo",
		subdir: "plugins/xray",
		requestedRef: "feature/audit",
		display: "owner/repo/plugins/xray",
		...overrides,
	};
}

function jsonResponse(value, options = {}) {
	return new Response(JSON.stringify(value), {
		status: options.status ?? 200,
		headers: options.headers,
	});
}

function successfulFetch(options = {}) {
	const calls = [];
	const blobs = new Map([
		[MANIFEST_SHA, MANIFEST],
		[SCRIPT_SHA, SCRIPT],
	]);
	const fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		const path = `${url.pathname}${url.search}`;
		if (path.includes("/commits/")) {
			return jsonResponse({
				sha: COMMIT_SHA,
				commit: { tree: { sha: TREE_SHA } },
			});
		}
		if (path.includes("/git/trees/")) {
			return jsonResponse({
				truncated: options.truncated ?? false,
				tree: [
					{
						path: "README.md",
						type: "blob",
						sha: "4444444444444444444444444444444444444444",
						size: 10,
					},
					{
						path: "plugins/xray/herdr-plugin.toml",
						type: "blob",
						sha: MANIFEST_SHA,
						size: Buffer.byteLength(MANIFEST),
					},
					{
						path: "plugins/xray/literal\\name.mjs",
						type: "blob",
						sha: BACKSLASH_SHA,
						size: 0,
					},
					{
						path: "plugins/xray/scripts",
						type: "tree",
						sha: "5555555555555555555555555555555555555555",
					},
					{
						path: "plugins/xray/scripts/run.mjs",
						type: "blob",
						sha: SCRIPT_SHA,
						size: Buffer.byteLength(SCRIPT),
					},
				],
			});
		}
		const sha = path.split("/").at(-1);
		const content = blobs.get(sha);
		if (content !== undefined) {
			const payload = options.blobPayload?.({ sha, content }) ?? {
				sha,
				size: Buffer.byteLength(content),
				encoding: "base64",
				content: Buffer.from(content).toString("base64"),
			};
			return jsonResponse(payload);
		}
		return jsonResponse({ message: "not found" }, { status: 404 });
	};
	return { fetch, calls };
}

test("resolves a commit and reads only subdirectory blobs", async () => {
	const mock = successfulFetch();
	const source = await GitHubRestSource.open(input(), { fetch: mock.fetch });
	assert.equal(source.resolvedCommit, COMMIT_SHA);
	assert.deepEqual(
		source.listEntries().map((entry) => entry.path),
		["herdr-plugin.toml", "literal\\name.mjs", "scripts", "scripts/run.mjs"],
	);
	const file = await source.readFile("herdr-plugin.toml", { maxBytes: 1024 });
	assert.equal(file.bytes.toString("utf8"), MANIFEST);
	assert.equal(mock.calls.length, 3);
	for (const call of mock.calls) {
		assert.equal(call.init.redirect, "manual");
		assert.equal(Object.hasOwn(call.init.headers, "Authorization"), false);
		assert.match(call.url, /^https:\/\/api\.github\.com\//);
	}
	assert.match(mock.calls[0].url, /commits\/feature%2Faudit$/);
});

test("records truncated trees as an explicit issue", async () => {
	const mock = successfulFetch({ truncated: true });
	const source = await GitHubRestSource.open(input(), { fetch: mock.fetch });
	assert.equal(
		source.issues.some((issue) => issue.code === "tree-truncated"),
		true,
	);
	assert.equal(Object.isFrozen(source.issues), true);
});

test("enforces request and streamed response budgets", async () => {
	const mock = successfulFetch();
	await assert.rejects(
		() =>
			GitHubRestSource.open(input(), {
				fetch: mock.fetch,
				limits: { githubRequests: 1 },
			}),
		(error) => error instanceof SourceError && error.code === "request-limit",
	);

	const oversized = async () => new Response("x".repeat(128));
	await assert.rejects(
		() =>
			GitHubRestSource.open(input(), {
				fetch: oversized,
				limits: { githubCommitResponseBytes: 16, githubTotalResponseBytes: 64 },
			}),
		(error) => error instanceof SourceError && error.code === "response-limit",
	);
});

test("deadline and cancellation cover stalled response bodies", {
	timeout: 1000,
}, async () => {
	let requestSignal;
	const hanging = async (_url, init) => {
		requestSignal = init.signal;
		return new Response(new ReadableStream({ start() {} }));
	};
	await assert.rejects(
		() =>
			GitHubRestSource.open(input(), {
				fetch: hanging,
				limits: { timeoutMs: 20 },
			}),
		(error) => error instanceof SourceError && error.code === "timeout",
	);
	assert.equal(requestSignal.aborted, true);
});

test("refuses redirects and cancels their response bodies", async () => {
	let cancelled = false;
	const redirect = async () =>
		new Response(
			new ReadableStream({
				cancel() {
					cancelled = true;
				},
			}),
			{
				status: 302,
				headers: { Location: "https://example.com/steal" },
			},
		);
	await assert.rejects(
		() => GitHubRestSource.open(input(), { fetch: redirect }),
		(error) => error instanceof SourceError && error.code === "redirect",
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(cancelled, true);
});

test("rejects malformed blob metadata and decoded-size overruns", async () => {
	const mock = successfulFetch();
	const source = await GitHubRestSource.open(input(), { fetch: mock.fetch });
	await assert.rejects(
		() => source.readFile("herdr-plugin.toml", { maxBytes: 2 }),
		(error) => error instanceof SourceError && error.code === "file-limit",
	);

	for (const payload of [
		{ sha: MANIFEST_SHA, size: 3, encoding: "base64", content: "***=" },
		{ sha: MANIFEST_SHA, size: 1, encoding: "base64", content: "AB==" },
		{
			sha: MANIFEST_SHA,
			encoding: "base64",
			content: Buffer.from(MANIFEST).toString("base64"),
		},
	]) {
		const invalidBlobFetch = successfulFetch({ blobPayload: () => payload });
		const invalidSource = await GitHubRestSource.open(input(), {
			fetch: invalidBlobFetch.fetch,
		});
		await assert.rejects(
			() => invalidSource.readFile("herdr-plugin.toml"),
			(error) =>
				error instanceof SourceError &&
				["invalid-base64", "invalid-blob"].includes(error.code),
		);
	}
});

test("enforces the independent GitHub blob-count budget", async () => {
	const mock = successfulFetch();
	const source = await GitHubRestSource.open(input(), {
		fetch: mock.fetch,
		limits: { githubBlobs: 0 },
	});
	await assert.rejects(
		() => source.readFile("herdr-plugin.toml"),
		(error) =>
			error instanceof SourceError && error.code === "blob-count-limit",
	);
});
