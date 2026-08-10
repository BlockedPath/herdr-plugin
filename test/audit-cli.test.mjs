import assert from "node:assert/strict";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditSource } from "../src/audit/audit.mjs";
import { main } from "../src/cli/main.mjs";
import { EXIT } from "../src/cli/contract.mjs";
import { validateReceiptContract } from "../src/receipt/contract.mjs";

function parseJson(source) {
	try {
		return JSON.parse(source);
	} catch (error) {
		assert.fail(`expected valid JSON: ${error}`);
	}
}

async function withPlugin(run) {
	const root = await mkdtemp(join(tmpdir(), "herdr-xray-audit-"));
	try {
		await writeFile(
			join(root, "herdr-plugin.toml"),
			`
id = "example.audit"
name = "Audit fixture"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos", "windows"]

[[build]]
command = ["node", "build.mjs"]

[[actions]]
id = "run"
title = "Run"
command = ["node", "run.mjs"]
`,
		);
		await writeFile(
			join(root, "build.mjs"),
			"throw new Error('must not execute');\n",
		);
		await writeFile(
			join(root, "run.mjs"),
			`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(root, "EXECUTED"))}, "bad");\n`,
		);
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function capture() {
	let stdout = "";
	let stderr = "";
	return {
		io: {
			stdout: {
				write: (value) => {
					stdout += value;
				},
			},
			stderr: {
				write: (value) => {
					stderr += value;
				},
			},
		},
		output: () => ({ stdout, stderr }),
	};
}

test("audit emits a schema-shaped JSON receipt without executing target code", async () => {
	await withPlugin(async (root) => {
		const result = capture();
		assert.equal(
			await main(["audit", root, "--format", "json"], result.io),
			EXIT.OK,
		);
		assert.equal(result.output().stderr, "");
		assert.equal(result.output().stdout.includes(root), false);
		const receipt = parseJson(result.output().stdout);
		assert.deepEqual(validateReceiptContract(receipt), []);
		assert.equal(receipt.subject.plugin.id, "example.audit");
		assert.equal(receipt.completeness.complete, true);
		assert.deepEqual(
			receipt.provenance.files.map((file) => file.path),
			["build.mjs", "herdr-plugin.toml", "run.mjs"],
		);
		await assert.rejects(() => access(join(root, "EXECUTED")));
	});
});

test("both redaction modes remove authorization, URL secrets, and absolute paths", async () => {
	await withPlugin(async (root) => {
		const manifestPath = join(root, "herdr-plugin.toml");
		const current = await readFile(manifestPath, "utf8");
		const sensitive = [
			"SUPERSECRET123456789012345678901234",
			"Authorization: Bearer short-secret",
			"/Users/alice/My Secret/private-key",
			"C:/Users/Alice/secret.txt",
			"\\\\server\\share\\secret.txt",
			"https://example.test/path?token=SUPERSECRET123",
		];
		const command = JSON.stringify([
			"node",
			"run.mjs",
			"--token",
			...sensitive,
		]);
		await writeFile(
			manifestPath,
			`${current}\n[[actions]]\nid = "secret"\ntitle = "Secret"\ncommand = ${command}\n`,
		);
		for (const mode of ["strict", "standard"]) {
			const result = capture();
			assert.equal(
				await main(
					["audit", root, "--format", "json", "--redaction", mode],
					result.io,
				),
				EXIT.OK,
			);
			const output = result.output().stdout;
			for (const value of [
				"SUPERSECRET",
				"short-secret",
				"/Users/alice",
				"C:/Users",
				"server\\\\share",
				"?token=",
			]) {
				assert.equal(output.includes(value), false, `${mode}: ${value}`);
			}
			assert.match(output, /<redacted>|<absolute-path>/);
		}
	});
});

test("audit recursively traces imports and converts analyzer evidence into findings", async () => {
	await withPlugin(async (root) => {
		await writeFile(
			join(root, "run.mjs"),
			`
import "./helper.mjs";
const token = process.env.API_TOKEN;
fetch("https://api.example.test/v1?secret=hidden");
fetch(endpoint);
spawn(command);
`,
		);
		await writeFile(join(root, "helper.mjs"), `import "./nested.mjs";\n`);
		await writeFile(join(root, "nested.mjs"), `export const value = 1;\n`);
		const receipt = await auditSource(root);
		assert.deepEqual(
			receipt.provenance.files.map((file) => file.path),
			["build.mjs", "helper.mjs", "herdr-plugin.toml", "nested.mjs", "run.mjs"],
		);
		assert.equal(receipt.completeness.complete, false);
		assert.equal(
			receipt.findings.some(
				(entry) => entry.ruleId === "xray.credential.environment-read",
			),
			true,
		);
		assert.equal(
			receipt.findings.some(
				(entry) => entry.ruleId === "xray.network.endpoint",
			),
			true,
		);
		assert.equal(
			receipt.findings.some(
				(entry) => entry.ruleId === "xray.network.dynamic-endpoint",
			),
			true,
		);
		assert.equal(
			receipt.findings.filter(
				(entry) => entry.ruleId === "xray.execution.dynamic-subprocess",
			).length,
			1,
		);
		assert.equal(
			receipt.graph.nodes.some((node) => node.type === "network-endpoint"),
			true,
		);
		assert.equal(
			receipt.graph.edges.some((edge) => edge.type === "imports"),
			true,
		);
	});
});

test("Python package imports trace package initialization and imported modules", async () => {
	await withPlugin(async (root) => {
		const manifestPath = join(root, "herdr-plugin.toml");
		const current = await readFile(manifestPath, "utf8");
		await writeFile(
			manifestPath,
			`${current}\n[[actions]]\nid = "python"\ntitle = "Python"\ncommand = ["python3", "entry.py"]\n`,
		);
		await writeFile(join(root, "entry.py"), "from .pkg import helper\n");
		await mkdir(join(root, "pkg"));
		await writeFile(join(root, "pkg", "__init__.py"), "value = 1\n");
		await writeFile(join(root, "pkg", "helper.py"), "value = 2\n");
		const receipt = await auditSource(root);
		const paths = receipt.provenance.files.map((file) => file.path);
		assert.equal(paths.includes("pkg/__init__.py"), true);
		assert.equal(paths.includes("pkg/helper.py"), true);
	});
});

test("distinct lifecycle scripts and endpoints remain distinct findings", async () => {
	await withPlugin(async (root) => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				scripts: {
					install: "curl https://one.example/install",
					postinstall: "curl https://two.example/install",
				},
			}),
		);
		const receipt = await auditSource(root);
		assert.equal(
			receipt.findings.filter(
				(entry) => entry.ruleId === "xray.package.lifecycle-script",
			).length,
			2,
		);
		assert.equal(
			receipt.findings.filter(
				(entry) => entry.ruleId === "xray.network.endpoint",
			).length,
			2,
		);
	});
});

test("audit renders terminal and Markdown reports from the same core", async () => {
	await withPlugin(async (root) => {
		const terminal = capture();
		assert.equal(await main(["audit", root], terminal.io), EXIT.OK);
		assert.match(terminal.output().stdout, /Herdr X-Ray — example\.audit/);
		assert.match(terminal.output().stdout, /Install-time build command/);

		const markdown = capture();
		assert.equal(
			await main(["audit", root, "--format", "markdown"], markdown.io),
			EXIT.OK,
		);
		assert.match(markdown.output().stdout, /^# Herdr X-Ray: example\.audit/m);
	});
});

test("explicit finding policy fails only after emitting the receipt", async () => {
	await withPlugin(async (root) => {
		const result = capture();
		assert.equal(
			await main(
				["audit", root, "--format", "json", "--fail-on-severity", "high"],
				result.io,
			),
			EXIT.POLICY,
		);
		assert.equal(
			parseJson(result.output().stdout).summary.bySeverity.high > 0,
			true,
		);
	});
});

test("analysis, graph, and finding limits cannot produce a complete oversized receipt", async () => {
	await withPlugin(async (root) => {
		const receipt = await auditSource(root, {
			limits: {
				filesAnalyzed: 1,
				graphNodes: 1,
				graphEdges: 1,
				findings: 1,
			},
		});
		assert.equal(receipt.completeness.complete, false);
		assert.ok(receipt.provenance.files.length <= 1);
		assert.ok(receipt.graph.nodes.length <= 1);
		assert.ok(receipt.graph.edges.length <= 1);
		assert.ok(receipt.findings.length <= 1);
	});
});

test("atomic output writes a report without stdout noise", async () => {
	await withPlugin(async (root) => {
		const result = capture();
		const output = join(root, "receipt.json");
		assert.equal(
			await main(
				["audit", root, "--format", "json", "--output", output],
				result.io,
			),
			EXIT.OK,
		);
		assert.equal(result.output().stdout, "");
		assert.equal(
			parseJson(await readFile(output, "utf8")).subject.plugin.id,
			"example.audit",
		);
	});
});
