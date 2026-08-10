import { constants } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, win32 } from "node:path";

import { resolveLimits } from "../config/limits.mjs";

const CONTROL_PATTERN = /\p{C}/u;
const READ_CHUNK_BYTES = 64 * 1024;

export class SourceError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "SourceError";
		this.code = code;
		this.details = details;
	}
}

export class FilesystemSource {
	static async open(root, options = {}) {
		const resolvedRoot = await realpath(root);
		const rootStat = await stat(resolvedRoot);
		if (!rootStat.isDirectory()) {
			throw new SourceError(
				"root-not-directory",
				"source root must be a directory",
			);
		}
		return new FilesystemSource(resolvedRoot, rootStat, options);
	}

	constructor(root, rootStat, options = {}) {
		this.kind = "local";
		this.root = root;
		this.limits = resolveLimits(options.limits);
		this.initialRootSignature = signature(rootStat);
		this.entrySignatures = new Map();
		this.directoryPaths = new Set();
		this.enumerated = false;
		this.unstable = false;
	}

	async readFile(relativePath, options = {}) {
		const normalized = normalizeSourcePath(relativePath);
		const maxBytes = options.maxBytes ?? this.limits.singleTextFileBytes;
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
			throw new SourceError(
				"invalid-limit",
				"file byte limit must be a non-negative integer",
			);
		}

		const absolutePath = await this.#containedPath(normalized, "file");
		const noFollow = constants.O_NOFOLLOW ?? 0;
		let handle;
		try {
			handle = await open(absolutePath, constants.O_RDONLY | noFollow);
		} catch (error) {
			if (error?.code === "ELOOP") {
				throw new SourceError(
					"symlink",
					`refusing symbolic link: ${normalized}`,
				);
			}
			throw error;
		}

		try {
			const before = await handle.stat();
			if (!before.isFile()) {
				throw new SourceError(
					"not-regular",
					`refusing non-regular file: ${normalized}`,
				);
			}
			const expectedSignature = this.entrySignatures.get(normalized);
			if (
				expectedSignature !== undefined &&
				expectedSignature !== signature(before)
			) {
				this.unstable = true;
				throw new SourceError(
					"source-mutated",
					`file changed after enumeration: ${normalized}`,
				);
			}
			if (before.size > maxBytes) {
				throw new SourceError(
					"file-limit",
					`file exceeds ${maxBytes} bytes: ${normalized}`,
					{
						limit: maxBytes,
						size: before.size,
					},
				);
			}
			const bytes = await readBoundedHandle(handle, maxBytes, normalized);
			const after = await handle.stat();
			if (signature(before) !== signature(after)) {
				this.unstable = true;
				throw new SourceError(
					"source-mutated",
					`file changed during audit: ${normalized}`,
				);
			}
			await this.verifyStable();
			return Object.freeze({ path: normalized, bytes, size: bytes.length });
		} finally {
			await handle.close();
		}
	}

	async listEntries() {
		const entries = [];
		const pending = [""];
		while (pending.length > 0) {
			const directory = pending.shift();
			const absoluteDirectory =
				directory === "" ? this.root : join(this.root, ...directory.split("/"));
			const children = [];
			const stream = await opendir(absoluteDirectory);
			for await (const entry of stream) {
				if (entry.name.toLowerCase() === ".git") {
					continue;
				}
				if (CONTROL_PATTERN.test(entry.name) || entry.name.length > 1024) {
					throw new SourceError(
						"unsafe-path",
						"source contains an unsafe path component",
					);
				}
				children.push(entry.name);
				if (entries.length + children.length > this.limits.filesEnumerated) {
					throw new SourceError(
						"file-count-limit",
						`source exceeds ${this.limits.filesEnumerated} enumerated entries`,
					);
				}
			}
			children.sort(compareNames);

			for (const name of children) {
				const path = directory === "" ? name : `${directory}/${name}`;
				const absolutePath = join(this.root, ...path.split("/"));
				const metadata = await lstat(absolutePath);
				const type = entryType(metadata);
				this.entrySignatures.set(path, signature(metadata));
				entries.push(
					Object.freeze({
						path,
						type,
						size: metadata.isFile() ? metadata.size : null,
					}),
				);
				if (type === "directory") {
					this.directoryPaths.add(path);
					pending.push(path);
				}
			}
		}
		this.enumerated = true;
		await this.verifyStable();
		return Object.freeze(entries);
	}

	async verifyStable() {
		const current = await stat(this.root);
		if (signature(current) !== this.initialRootSignature) {
			return this.#mutation("source root changed during audit");
		}
		for (const path of this.directoryPaths) {
			let metadata;
			try {
				metadata = await lstat(join(this.root, ...path.split("/")));
			} catch {
				return this.#mutation(
					`source directory disappeared during audit: ${path}`,
				);
			}
			if (signature(metadata) !== this.entrySignatures.get(path)) {
				return this.#mutation(`source directory changed during audit: ${path}`);
			}
		}
		return true;
	}

	async #containedPath(normalized, expectedType) {
		const segments = normalized.split("/");
		let current = this.root;
		for (let index = 0; index < segments.length; index += 1) {
			current = join(current, segments[index]);
			const metadata = await lstat(current);
			const traversedPath = segments.slice(0, index + 1).join("/");
			const expectedSignature = this.entrySignatures.get(traversedPath);
			if (this.enumerated && expectedSignature === undefined) {
				return this.#mutation(
					`path appeared after enumeration: ${traversedPath}`,
				);
			}
			if (
				expectedSignature !== undefined &&
				expectedSignature !== signature(metadata)
			) {
				return this.#mutation(
					`path changed after enumeration: ${traversedPath}`,
				);
			}
			if (metadata.isSymbolicLink()) {
				throw new SourceError(
					"symlink",
					`refusing symbolic link: ${normalized}`,
				);
			}
			if (index < segments.length - 1 && !metadata.isDirectory()) {
				throw new SourceError(
					"not-directory",
					`path parent is not a directory: ${normalized}`,
				);
			}
			if (
				index === segments.length - 1 &&
				expectedType === "file" &&
				!metadata.isFile()
			) {
				throw new SourceError(
					"not-regular",
					`refusing non-regular file: ${normalized}`,
				);
			}
		}
		const containment = relative(this.root, current);
		if (containment.startsWith("..") || isAbsolute(containment)) {
			throw new SourceError(
				"path-escape",
				`path escapes source root: ${normalized}`,
			);
		}
		return current;
	}

	#mutation(message) {
		this.unstable = true;
		throw new SourceError("source-mutated", message);
	}
}

export function normalizeSourcePath(value, options = {}) {
	if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
		throw new SourceError("invalid-path", "source path is empty or too long");
	}
	if (
		CONTROL_PATTERN.test(value) ||
		isAbsolute(value) ||
		win32.isAbsolute(value)
	) {
		throw new SourceError(
			"unsafe-path",
			"source path must be a relative path without control characters",
		);
	}
	const pathValue =
		(options.windows ?? process.platform === "win32")
			? value.replaceAll("\\", "/")
			: value;
	const segments = pathValue.split("/");
	const normalized = [];
	for (const segment of segments) {
		if (segment === "" || segment === ".") {
			continue;
		}
		if (segment === "..") {
			throw new SourceError(
				"path-escape",
				"source path may not contain parent traversal",
			);
		}
		normalized.push(segment);
	}
	if (normalized.length === 0) {
		throw new SourceError("invalid-path", "source path does not name a file");
	}
	return normalized.join("/");
}

async function readBoundedHandle(handle, maxBytes, path) {
	const chunks = [];
	let total = 0;
	let position = 0;
	while (true) {
		const remainingWithSentinel = maxBytes - total + 1;
		const length = Math.min(READ_CHUNK_BYTES, remainingWithSentinel);
		const chunk = Buffer.allocUnsafe(Math.max(1, length));
		const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
		if (bytesRead === 0) {
			break;
		}
		total += bytesRead;
		if (total > maxBytes) {
			throw new SourceError(
				"file-limit",
				`file exceeds ${maxBytes} bytes: ${path}`,
				{
					limit: maxBytes,
				},
			);
		}
		chunks.push(chunk.subarray(0, bytesRead));
		position += bytesRead;
	}
	return Buffer.concat(chunks, total);
}

function entryType(metadata) {
	if (metadata.isSymbolicLink()) return "symlink";
	if (metadata.isFile()) return "file";
	if (metadata.isDirectory()) return "directory";
	return "other";
}

function signature(metadata) {
	return [
		metadata.dev,
		metadata.ino,
		metadata.mode,
		metadata.size,
		metadata.mtimeMs,
	].join(":");
}

function compareNames(left, right) {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}
