const URL_PATTERN = /https?:\/\/[^\s"'`<>)}\]]+/gi;
const CREDENTIAL_PATTERN =
	/(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL|AUTH)/i;

export function scanCommon(lines, collector) {
	for (const line of lines) {
		for (const match of line.text.matchAll(URL_PATTERN)) {
			collector.fact("network-endpoint", endpoint(match[0]), line.number, {
				operation: "connect",
				excerpt: match[0],
			});
		}
	}
}

export function recordEnvironment(name, line, collector) {
	collector.fact("environment-read", name, line, {
		operation: CREDENTIAL_PATTERN.test(name)
			? "credential-like"
			: "environment",
	});
}

export function isCredentialLike(name) {
	return CREDENTIAL_PATTERN.test(name);
}

function endpoint(value) {
	try {
		const url = new URL(value);
		return url.origin;
	} catch {
		return value.slice(0, 256);
	}
}
