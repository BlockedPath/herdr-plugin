const URL_PATTERN = /https?:\/\/[^\s"'`<>)}\]]+/gi;
const POSIX_ABSOLUTE = /(^|[\s=(,])\/(?!\/)[^\s"'`,;)]+/g;
const WINDOWS_ABSOLUTE = /\b[A-Za-z]:[\\/][^\s"'`,;)]+/g;
const UNC_ABSOLUTE = /\\\\[^\\\s]+\\[^\s"'`,;)]+/g;
const QUOTED_POSIX_ABSOLUTE = /(["'])\/[^"']*\1/g;
const AUTHORIZATION = /\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[^\s"'`,;)]+/gi;
const SECRET_ASSIGNMENT =
	/\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTH)[A-Za-z0-9_]*)=([^\s]+)/gi;
const SECRET_FLAG =
	/(?:token|secret|pass(?:word|wd)?|api[-_]?key|private[-_]?key|credential|auth)/i;
const SECRET_CLI_VALUE =
	/(--?(?:token|secret|pass(?:word|wd)?|api[-_]?key|private[-_]?key|credential|auth)\s+)([^\s]+)/gi;
const HIGH_ENTROPY = /\b[A-Za-z0-9+/_=-]{32,}\b/g;

export function redactReceipt(receipt, mode = "strict") {
	return visit(receipt, mode, null);
}

function visit(value, mode, key) {
	if (Array.isArray(value)) {
		if (key === "argv") return redactArgv(value, mode);
		return value.map((entry) => visit(entry, mode, null));
	}
	if (value !== null && typeof value === "object") {
		const redacted = Object.fromEntries(
			Object.entries(value).map(([name, entry]) => [
				name,
				visit(entry, mode, name),
			]),
		);
		if (
			redacted.type === "command" &&
			Array.isArray(redacted.attributes?.argv)
		) {
			redacted.label = redacted.attributes.argv.join(" ");
		}
		return redacted;
	}
	if (typeof value === "string") {
		if (
			[
				"sha",
				"sha256",
				"resolvedCommit",
				"localRootHash",
				"analysisHash",
				"receiptHash",
			].includes(key)
		) {
			return value;
		}
		return redactString(value, mode);
	}
	return value;
}

function redactArgv(argv, mode) {
	let redactNext = false;
	return argv.map((entry) => {
		const value = String(entry);
		if (redactNext) {
			redactNext = false;
			return "<redacted>";
		}
		const equals = /^(--?[^=]+)=(.*)$/.exec(value);
		if (equals !== null && SECRET_FLAG.test(equals[1]))
			return `${equals[1]}=<redacted>`;
		if (value.startsWith("-") && SECRET_FLAG.test(value)) redactNext = true;
		return redactString(value, mode);
	});
}

function redactString(value, mode) {
	if (
		value.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(value) ||
		value.startsWith("\\\\")
	)
		return "<absolute-path>";
	let result = value.replace(URL_PATTERN, (url) => redactUrl(url));
	result = result.replace(AUTHORIZATION, "Authorization: <redacted>");
	result = result.replace(SECRET_ASSIGNMENT, "$1=<redacted>");
	result = result.replace(SECRET_CLI_VALUE, "$1<redacted>");
	result = result.replace(
		QUOTED_POSIX_ABSOLUTE,
		(_match, quote) => `${quote}<absolute-path>${quote}`,
	);
	result = result.replace(
		POSIX_ABSOLUTE,
		(_match, prefix) => `${prefix}<absolute-path>`,
	);
	result = result.replace(WINDOWS_ABSOLUTE, "<absolute-path>");
	result = result.replace(UNC_ABSOLUTE, "<absolute-path>");
	if (mode === "strict") result = result.replace(HIGH_ENTROPY, "<redacted>");
	return result;
}

function redactUrl(value) {
	try {
		const url = new URL(value);
		return `${url.origin}${url.pathname}`;
	} catch {
		return "<url>";
	}
}
