import { analyzeBatch } from "./batch.mjs";
import { analyzeBinary, classifyBinary } from "./binary.mjs";
import { analyzeGenericText } from "./generic-text.mjs";
import { analyzeJavaScript } from "./javascript.mjs";
import { analysisResult, analyzerIssue } from "./model.mjs";
import { analyzePackageJson } from "./package-json.mjs";
import { analyzePowerShell } from "./powershell.mjs";
import { analyzePython } from "./python.mjs";
import { analyzeShell } from "./shell.mjs";
import { decodeText } from "./text.mjs";

const CODE_EXTENSIONS = new Set([
	".c",
	".cc",
	".cpp",
	".cs",
	".go",
	".java",
	".kt",
	".lua",
	".php",
	".rb",
	".rs",
	".swift",
]);

export function analyzeReachableFile(input) {
	const { path, bytes, limits } = input;
	if (
		/^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n/.test(
			bytes.subarray(0, 80).toString("ascii"),
		)
	) {
		return analysisResult("git-lfs", {
			issues: [
				analyzerIssue(
					"git-lfs",
					"reachable file is an unresolved Git LFS pointer",
					path,
				),
			],
		});
	}
	const format = classifyBinary(bytes);
	if (format !== null) return analyzeBinary(path, format);
	if (basename(path).toLowerCase() === "package.json") {
		return analyzePackageJson(path, bytes, limits);
	}
	const extension = extensionOf(path);
	const shebang = bytes
		.subarray(0, Math.min(bytes.length, 160))
		.toString("utf8")
		.split("\n", 1)[0];
	if (
		[".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"].includes(extension) ||
		/\b(?:node|bun|deno)\b/.test(shebang)
	) {
		return analyzeJavaScript(path, bytes, limits);
	}
	if (
		[".sh", ".bash", ".zsh", ".fish"].includes(extension) ||
		/^#!.*\b(?:bash|sh|zsh|fish)\b/.test(shebang)
	) {
		return analyzeShell(path, bytes, limits);
	}
	if (extension === ".py" || /^#!.*\bpython[0-9.]*\b/.test(shebang))
		return analyzePython(path, bytes, limits);
	if (extension === ".ps1") return analyzePowerShell(path, bytes, limits);
	if (extension === ".bat" || extension === ".cmd")
		return analyzeBatch(path, bytes, limits);
	const decoded = decodeText(bytes, path);
	if (typeof decoded !== "string")
		return analysisResult("unknown", { issues: [decoded.error] });
	if (CODE_EXTENSIONS.has(extension)) {
		return analysisResult(extension.slice(1), {
			issues: [
				analyzerIssue(
					"unsupported-language",
					`reachable ${extension.slice(1)} source uses an unsupported analyzer`,
					path,
				),
			],
		});
	}
	return analyzeGenericText(path, bytes, limits);
}

function basename(path) {
	return path.split("/").at(-1);
}

function extensionOf(path) {
	const name = basename(path);
	const index = name.lastIndexOf(".");
	return index <= 0 ? "" : name.slice(index).toLowerCase();
}
