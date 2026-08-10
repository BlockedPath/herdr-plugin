import {
	analysisResult,
	analyzerIssue,
	boundedPush,
	fact,
	reference,
} from "./model.mjs";
import { analyzeShell } from "./shell.mjs";
import { decodeText, excerpt } from "./text.mjs";

const LIFECYCLE_NAMES = new Set([
	"preinstall",
	"install",
	"postinstall",
	"prepare",
	"prepublish",
	"prepublishOnly",
	"prepack",
	"postpack",
	"publish",
	"postpublish",
	"preversion",
	"version",
	"postversion",
	"dependencies",
]);

export function analyzePackageJson(path, bytes, limits) {
	const decoded = decodeText(bytes, path);
	if (typeof decoded !== "string")
		return analysisResult("json", { issues: [decoded.error] });
	let document;
	try {
		document = JSON.parse(decoded);
	} catch {
		return analysisResult("json", {
			issues: [
				analyzerIssue(
					"invalid-package-json",
					"package.json is not valid JSON",
					path,
				),
			],
		});
	}
	if (
		document === null ||
		typeof document !== "object" ||
		Array.isArray(document)
	) {
		return analysisResult("json", {
			issues: [
				analyzerIssue(
					"invalid-package-json",
					"package.json root is not an object",
					path,
				),
			],
		});
	}
	const facts = [];
	const references = [];
	const issues = [];
	const scripts = document.scripts;
	if (
		scripts !== undefined &&
		(scripts === null || typeof scripts !== "object" || Array.isArray(scripts))
	) {
		issues.push(
			analyzerIssue(
				"invalid-package-scripts",
				"package.json scripts is not an object",
				path,
			),
		);
	} else if (scripts !== undefined) {
		for (const [name, command] of Object.entries(scripts)) {
			if (!LIFECYCLE_NAMES.has(name) || typeof command !== "string") continue;
			boundedPush(
				facts,
				fact("package-lifecycle", name, path, null, {
					operation: name,
					excerpt: excerpt(command, limits.evidenceExcerptCodeUnits),
				}),
				limits.analyzerFactsPerFile,
				issues,
				{
					code: "fact-limit",
					message: "package analyzer fact limit reached",
					path,
					limit: "analyzerFactsPerFile",
				},
			);
			const script =
				/^(?:node|bun|deno|python3?|bash|sh|pwsh|powershell)\s+["']?([^\s"']+)/i.exec(
					command,
				)?.[1];
			if (
				script !== undefined &&
				(script.startsWith(".") ||
					script.includes("/") ||
					/\.[A-Za-z0-9]+$/.test(script))
			) {
				boundedPush(
					references,
					reference("spawn-script", script, path, null),
					limits.referencesPerFile,
					issues,
					{
						code: "reference-limit",
						message: "package analyzer reference limit reached",
						path,
						limit: "referencesPerFile",
					},
				);
			}
			const shell = analyzeShell(path, Buffer.from(command), limits);
			for (const shellFact of shell.facts) {
				boundedPush(facts, shellFact, limits.analyzerFactsPerFile, issues, {
					code: "fact-limit",
					message: "package analyzer fact limit reached",
					path,
					limit: "analyzerFactsPerFile",
				});
			}
			for (const shellReference of shell.references) {
				boundedPush(
					references,
					shellReference,
					limits.referencesPerFile,
					issues,
					{
						code: "reference-limit",
						message: "package analyzer reference limit reached",
						path,
						limit: "referencesPerFile",
					},
				);
			}
			for (const shellIssue of shell.issues) {
				if (issues.length < limits.analyzerIssuesPerFile)
					issues.push(shellIssue);
			}
		}
	}
	return analysisResult("json", { facts, references, issues });
}
