import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InputError, resolveInput } from "../src/source/input.mjs";

async function withTempDirectory(run) {
	const root = await mkdtemp(join(tmpdir(), "herdr-xray-input-"));
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("existing relative directories win over GitHub shorthand", async () => {
	await withTempDirectory(async (root) => {
		await mkdir(join(root, "owner", "repo"), { recursive: true });
		const input = await resolveInput("owner/repo", { cwd: root });
		assert.equal(input.kind, "local");
		assert.equal(input.root, await realpath(join(root, "owner", "repo")));
	});
});

test("normalizes GitHub shorthand, subdirectory, and ref", async () => {
	const input = await resolveInput("owner/repo/plugins/xray", {
		cwd: tmpdir(),
		ref: "feature/audit",
	});
	assert.deepEqual(input, {
		kind: "github",
		owner: "owner",
		repo: "repo",
		subdir: "plugins/xray",
		requestedRef: "feature/audit",
		display: "owner/repo/plugins/xray",
	});
});

test("accepts only repository-root GitHub HTTPS URLs", async () => {
	const input = await resolveInput("https://github.com/owner/repo.git", {
		cwd: tmpdir(),
	});
	assert.equal(input.kind, "github");
	assert.equal(input.repo, "repo");
	assert.equal(input.subdir, null);

	for (const source of [
		"http://github.com/owner/repo",
		"https://user@github.com/owner/repo",
		"https://github.com/owner/repo/tree/main",
		"https://github.com/owner/repo?tab=readme",
		"https://example.com/owner/repo",
	]) {
		await assert.rejects(
			() => resolveInput(source, { cwd: tmpdir() }),
			InputError,
			source,
		);
	}
});

test("rejects missing explicit local paths and unsafe refs", async () => {
	await assert.rejects(
		() => resolveInput("./definitely-missing", { cwd: tmpdir() }),
		(error) => error instanceof InputError && error.code === "local-not-found",
	);
	for (const ref of ["bad\nref", ".", ".."]) {
		await assert.rejects(
			() => resolveInput("owner/repo", { cwd: tmpdir(), ref }),
			(error) => error instanceof InputError && error.code === "invalid-ref",
		);
	}
	await assert.rejects(
		() => resolveInput("owner/repo/../escape", { cwd: tmpdir() }),
		(error) => error instanceof InputError && error.code === "invalid-subdir",
	);
});
