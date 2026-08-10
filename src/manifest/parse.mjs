import { DEFAULT_LIMITS } from "../config/limits.mjs";
import { parse } from "../../vendor/toml/index.mjs";

export class ManifestError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "ManifestError";
		this.code = code;
		this.details = details;
	}
}

export function parseManifest(bytes, options = {}) {
	const maxBytes = options.maxBytes ?? DEFAULT_LIMITS.manifestBytes;
	const maxDepth = options.maxDepth ?? DEFAULT_LIMITS.tomlDepth;
	if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
		throw new ManifestError("invalid-input", "manifest input must be bytes");
	}
	if (bytes.byteLength > maxBytes) {
		throw new ManifestError(
			"manifest-limit",
			`manifest exceeds ${maxBytes} bytes`,
			{
				limit: maxBytes,
				size: bytes.byteLength,
			},
		);
	}
	let source;
	try {
		source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new ManifestError("manifest-encoding", "manifest is not valid UTF-8");
	}
	try {
		return parse(source, { maxDepth });
	} catch (error) {
		throw new ManifestError("manifest-toml", "manifest is not valid TOML", {
			cause: error instanceof Error ? error.message : String(error),
		});
	}
}
