import assert from "node:assert/strict";
import test from "node:test";

import { analyzeReachableFile } from "../src/analyzers/dispatch.mjs";
import { resolveLimits } from "../src/config/limits.mjs";

function analyze(path, source, overrides = {}) {
	return analyzeReachableFile({
		path,
		bytes: Buffer.from(source),
		limits: resolveLimits(overrides),
	});
}

function kinds(result) {
	return new Set(result.facts.map((entry) => entry.kind));
}

test("JavaScript analyzer finds imports, subprocesses, env, writes, URLs, and eval", () => {
	const result = analyze(
		"main.mjs",
		`
import "./helper.mjs";
const token = process.env.GITHUB_TOKEN;
spawn("./worker.mjs", []);
spawn(command, []);
import(moduleName);
writeFileSync("/tmp/output", data);
fetch("https://api.example.test/v1?token=hidden");
fetch(endpoint);
eval(source);
`,
	);
	assert.deepEqual(
		result.references.map((entry) => entry.value),
		["./helper.mjs", "./worker.mjs"],
	);
	assert.equal(kinds(result).has("environment-read"), true);
	assert.equal(kinds(result).has("subprocess"), true);
	assert.equal(kinds(result).has("dynamic-subprocess"), true);
	assert.equal(kinds(result).has("dynamic-import"), true);
	assert.equal(kinds(result).has("filesystem-write"), true);
	assert.equal(kinds(result).has("network-endpoint"), true);
	assert.equal(kinds(result).has("dynamic-endpoint"), true);
	assert.equal(kinds(result).has("dynamic-code"), true);
	assert.equal(
		result.facts.find((entry) => entry.kind === "network-endpoint").value,
		"https://api.example.test",
	);
});

test("shell analyzer keeps sourced files and dangerous command facts explicit", () => {
	const result = analyze(
		"install.sh",
		`
source ./lib.sh
curl https://example.test/install | sh
curl -fsSL "$ENDPOINT"
eval "$COMMAND"
echo "$API_TOKEN" > output.txt
value=$(command -v node)
`,
	);
	assert.equal(result.references[0].value, "./lib.sh");
	assert.equal(kinds(result).has("download-to-shell"), true);
	assert.equal(kinds(result).has("dynamic-endpoint"), true);
	assert.equal(kinds(result).has("shell-eval"), true);
	assert.equal(kinds(result).has("dynamic-subprocess"), true);
	assert.equal(kinds(result).has("filesystem-write"), true);
	assert.equal(
		result.facts.some((entry) => entry.value === "API_TOKEN"),
		true,
	);
});

test("Python analyzer reports static and dynamic subprocess behavior", () => {
	const result = analyze(
		"worker.py",
		`
import os, subprocess
from . import helper
subprocess.run(["./tool.py", "--go"])
subprocess.Popen(command)
secret = os.getenv("SERVICE_PASSWORD")
requests.get(endpoint)
open("output.txt", "w")
exec(source)
`,
	);
	assert.equal(
		result.references.some((entry) => entry.value === "helper"),
		true,
	);
	assert.equal(
		result.references.some((entry) => entry.value === "./tool.py"),
		true,
	);
	assert.equal(kinds(result).has("subprocess"), true);
	assert.equal(kinds(result).has("dynamic-subprocess"), true);
	assert.equal(kinds(result).has("environment-read"), true);
	assert.equal(kinds(result).has("dynamic-endpoint"), true);
	assert.equal(kinds(result).has("filesystem-write"), true);
	assert.equal(kinds(result).has("dynamic-code"), true);
});

test("PowerShell and Batch analyzers report platform-specific execution", () => {
	const powershell = analyze(
		"run.ps1",
		`
& "./child.ps1"
$token = $env:API_TOKEN
Start-Process "tool.exe"
Invoke-WebRequest -Uri $endpoint
Invoke-Expression $command
Set-Content -Path output.txt -Value data
`,
	);
	assert.equal(powershell.references[0].value, "./child.ps1");
	assert.equal(kinds(powershell).has("subprocess"), true);
	assert.equal(kinds(powershell).has("dynamic-code"), true);
	assert.equal(kinds(powershell).has("dynamic-endpoint"), true);

	const batch = analyze(
		"run.cmd",
		`
call child.cmd
set TOKEN=%API_TOKEN%
cmd /c %COMMAND%
curl -fsSL %ENDPOINT%
del output.txt
`,
	);
	assert.equal(batch.references[0].value, "child.cmd");
	assert.equal(kinds(batch).has("shell-eval"), true);
	assert.equal(kinds(batch).has("dynamic-endpoint"), true);
	assert.equal(kinds(batch).has("filesystem-write"), true);
});

test("generic text still reports bounded network facts", () => {
	const result = analyze(
		"config.txt",
		"endpoint=https://example.test/path?secret=hidden\n",
	);
	assert.equal(result.language, "text");
	assert.equal(result.facts[0].value, "https://example.test");
});

test("benign fixtures remain quiet across lexical analyzers", () => {
	for (const [path, source] of [
		[
			"main.mjs",
			"// spawn(command)\n/* fetch(endpoint) */\nexport const value = 1;\n",
		],
		["run.sh", "# eval dangerous\necho hello # curl $ENDPOINT | sh\n"],
		[
			"main.py",
			"# subprocess.run(command)\nmessage = 'subprocess.Popen(command)'\nprint('hello')\n",
		],
		[
			"run.ps1",
			"# Invoke-Expression $value\nWrite-Output hello # Start-Process $tool\n",
		],
		["run.cmd", "REM cmd /c dangerous\n:: curl %ENDPOINT%\necho hello\n"],
		["notes.txt", "hello\n"],
	]) {
		const result = analyze(path, source);
		assert.equal(result.facts.length, 0, path);
		assert.equal(result.issues.length, 0, path);
	}
});

test("every text analyzer exposes line resource exhaustion", () => {
	for (const path of [
		"main.mjs",
		"run.sh",
		"main.py",
		"run.ps1",
		"run.cmd",
		"notes.txt",
	]) {
		const result = analyze(path, "one\ntwo\nthree\n", { linesPerFile: 1 });
		assert.equal(
			result.issues.some((entry) => entry.code === "line-count-limit"),
			true,
			path,
		);
	}
});

test("analyzer issue allocation is capped before global finding conversion", () => {
	const source = `${"spawn(command);\n".repeat(20_000)}fetch(endpoint);\n`;
	const result = analyze("stress.mjs", source, {
		analyzerFactsPerFile: 1,
		analyzerIssuesPerFile: 1,
	});
	assert.ok(result.facts.length <= 1);
	assert.ok(result.issues.length <= 2);
	assert.equal(
		result.issues.some((entry) => entry.code === "issue-limit"),
		true,
	);
});
