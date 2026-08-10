import { FilesystemSource } from "./filesystem-source.mjs";
import { GitHubRestSource } from "./github-rest-source.mjs";
import { resolveInput } from "./input.mjs";

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
