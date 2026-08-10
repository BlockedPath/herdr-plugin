import { FilesystemSource } from "./filesystem-source.mjs";
import { GitHubRestSource } from "./github-rest-source.mjs";
import { resolveInput } from "./input.mjs";
import { resolveInstalledInput } from "./installed.mjs";

export async function openSource(raw, options = {}) {
	const input = await resolveInput(raw, {
		cwd: options.cwd,
		ref: options.ref,
	});
	const source =
		input.kind === "local"
			? await FilesystemSource.open(input.root, { limits: options.limits })
			: await GitHubRestSource.open(input, {
					fetch: options.fetch,
					limits: options.limits,
					signal: options.signal,
				});
	return Object.freeze({ input, source });
}

export async function openInstalledSource(pluginId, options = {}) {
	const input = await resolveInstalledInput(pluginId, options);
	const source = await FilesystemSource.open(input.root, {
		kind: "installed",
		limits: options.limits,
	});
	return Object.freeze({ input, source });
}
