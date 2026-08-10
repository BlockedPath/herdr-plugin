import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	FilesystemSource,
	normalizeSourcePath,
	SourceError,
} from "../src/source/filesystem-source.mjs";

async function withFixture(run) {
	const root = await mkdtemp(join(tmpdir(), "herdr-xray-fs-"));
	try {
		await mkdir(join(root, "scripts"));
		await mkdir(join(root, ".GIT"));
		await writeFile(join(root, "herdr-plugin.toml"), 'id = "example"\n');
		await writeFile(
			join(root, "scripts", "run.mjs"),
			"console.log('not executed')\n",
		);
		await writeFile(join(root, ".GIT", "config"), "secret-like fixture\n");
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("enumerates deterministically without traversing .git", async () => {
	await withFixture(async (root) => {
		const source = await FilesystemSource.open(root);
		const entries = await source.listEntries();
		assert.deepEqual(
			entries.map((entry) => entry.path),
			["herdr-plugin.toml", "scripts", "scripts/run.mjs"],
		);
		assert.equal(
			entries.some((entry) => entry.path.toLowerCase().includes(".git")),
			false,
		);
	});
});

test("reads regular files through bounded handles", async () => {
	await withFixture(async (root) => {
		const source = await FilesystemSource.open(root);
		await source.listEntries();
		const result = await source.readFile("scripts/run.mjs", { maxBytes: 1024 });
		assert.equal(result.path, "scripts/run.mjs");
		assert.equal(
			result.bytes.toString("utf8"),
			"console.log('not executed')\n",
		);
		await assert.rejects(
			() => source.readFile("herdr-plugin.toml", { maxBytes: 2 }),
			(error) => error instanceof SourceError && error.code === "file-limit",
		);
	});
});

test("preserves literal backslashes on POSIX and normalizes them only for Windows", async (context) => {
	if (process.platform === "win32") {
		context.skip("Windows does not permit a literal backslash in a filename");
		return;
	}
	await withFixture(async (root) => {
		await writeFile(join(root, "literal\\name.mjs"), "literal\n");
		const source = await FilesystemSource.open(root);
		const entries = await source.listEntries();
		assert.equal(
			entries.some((entry) => entry.path === "literal\\name.mjs"),
			true,
		);
		const file = await source.readFile("literal\\name.mjs");
		assert.equal(file.bytes.toString("utf8"), "literal\n");
		assert.equal(
			normalizeSourcePath("scripts\\run.mjs", { windows: true }),
			"scripts/run.mjs",
		);
		assert.equal(
			normalizeSourcePath("literal\\name.mjs", { windows: false }),
			"literal\\name.mjs",
		);
	});
});

test("rejects traversal, absolute paths, and symlink reads", async (context) => {
	await withFixture(async (root) => {
		const source = await FilesystemSource.open(root);
		assert.throws(() => normalizeSourcePath("../outside"), SourceError);
		assert.throws(
			() => normalizeSourcePath(join(root, "outside")),
			SourceError,
		);

		const outside = join(root, "..", `outside-${Date.now()}.txt`);
		await writeFile(outside, "outside\n");
		try {
			try {
				await symlink(outside, join(root, "linked.txt"));
			} catch (error) {
				if (error?.code === "EPERM" || error?.code === "EACCES") {
					context.skip("symlink creation is unavailable on this platform");
					return;
				}
				throw error;
			}
			await assert.rejects(
				() => source.readFile("linked.txt"),
				(error) => error instanceof SourceError && error.code === "symlink",
			);
		} finally {
			await rm(outside, { force: true });
		}
	});
});

test("detects mutation after enumeration", async () => {
	await withFixture(async (root) => {
		const source = await FilesystemSource.open(root);
		await source.listEntries();
		await writeFile(join(root, "scripts", "run.mjs"), "changed\n");
		await assert.rejects(
			() => source.readFile("scripts/run.mjs"),
			(error) =>
				error instanceof SourceError && error.code === "source-mutated",
		);
		assert.equal(source.unstable, true);
	});
});

test("detects nested parent-directory mutation", async () => {
	await withFixture(async (root) => {
		const source = await FilesystemSource.open(root);
		await source.listEntries();
		await writeFile(join(root, "scripts", "new.mjs"), "new\n");
		await assert.rejects(
			() => source.readFile("scripts/run.mjs"),
			(error) =>
				error instanceof SourceError && error.code === "source-mutated",
		);
		assert.equal(source.unstable, true);
	});
});

test("enforces enumeration count", async () => {
	await withFixture(async (root) => {
		const source = await FilesystemSource.open(root, {
			limits: { filesEnumerated: 1 },
		});
		await assert.rejects(
			() => source.listEntries(),
			(error) =>
				error instanceof SourceError && error.code === "file-count-limit",
		);
	});
});
