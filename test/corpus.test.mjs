import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditSource } from "../src/audit/audit.mjs";
import { validateReceiptContract } from "../src/receipt/contract.mjs";
import { verifyReceipt } from "../src/receipt/verify.mjs";

const CASES = [
	{
		name: "crabbox — Go warm remote boxes",
		manifest: `
id = "crabbox"
name = "Crabbox"
version = "0.1.0"
min_herdr_version = "0.7.0"
platforms = ["linux", "macos"]

[[actions]]
id = "warm"
title = "Warm box"
command = ["node", "warm.mjs"]
`,
		files: { "warm.mjs": `import "./helper.mjs";\nfetch("https://example.test/warm");\n`, "helper.mjs": "export const h=1;\n" },
	},
	{
		name: "herdr-file-viewer — Rust TUI",
		manifest: `
id = "herdr-file-viewer"
name = "herdr-file-viewer"
version = "1.15.0"
min_herdr_version = "0.7.0"
platforms = ["linux", "macos", "windows"]

[[panes]]
id = "viewer"
title = "Viewer"
command = ["node", "viewer.mjs"]
`,
		files: { "viewer.mjs": `const t = process.env.TERM;\n` },
	},
	{
		name: "official.browser — duplicate ID case",
		manifest: `
id = "official.browser"
name = "Browser"
version = "0.1.0"
min_herdr_version = "0.7.4"
platforms = ["linux", "macos"]

[[actions]]
id = "open"
title = "Open"
command = ["node", "open.mjs"]
`,
		files: { "open.mjs": `fetch(endpoint);\n` },
	},
	{
		name: "worktrunk — shell worktree",
		manifest: `
id = "worktrunk"
name = "Worktrunk"
version = "0.1.0"
min_herdr_version = "0.7.0"
platforms = ["macos", "linux"]

[[actions]]
id = "switch"
title = "Switch"
command = ["bash", "switch.sh"]
`,
		files: { "switch.sh": `#!/bin/bash\ncurl -fsSL "$ENDPOINT" | bash\n` },
	},
	{
		name: "collie — TypeScript PWA with startup",
		manifest: `
id = "herdr.collie"
name = "Collie"
version = "0.26.0"
min_herdr_version = "0.7.0"
platforms = ["linux", "macos"]

[[startup]]
command = ["node", "serve.mjs"]

[[actions]]
id = "open"
title = "Open"
command = ["node", "open.mjs"]
`,
		files: { "serve.mjs": `import "node:http";\n`, "open.mjs": `export const v=1;\n` },
	},
	{
		name: "large and opaque — limit and WASM",
		manifest: `
id = "example.large"
name = "Large"
version = "1.0.0"
min_herdr_version = "0.8.0"
platforms = ["linux", "macos", "windows"]

[[actions]]
id = "run"
title = "Run"
command = ["node", "run.mjs"]

[[build]]
command = ["node", "build.mjs"]
`,
		files: {
			"run.mjs": `import fs from "node:fs"; fs.writeFileSync("out", "x");\n`,
			"build.mjs": `WebAssembly.instantiate(bytes);\n`,
			"large.bin": Buffer.alloc(1024, "x").toString(),
		},
	},
];

for (const c of CASES) {
	test(`corpus: ${c.name} audits within bounds and verifies`, async () => {
		const root = await mkdtemp(join(tmpdir(), "herdr-xray-corpus-"));
		try {
			await writeFile(join(root, "herdr-plugin.toml"), c.manifest);
			for (const [name, content] of Object.entries(c.files)) {
				await writeFile(join(root, name), content);
			}
			const receipt = await auditSource(root);
			assert.deepEqual(validateReceiptContract(receipt), []);
			// Receipt must verify (hashes valid)
			const path = join(root, "receipt.json");
			await writeFile(path, JSON.stringify(receipt));
			const loaded = await verifyReceipt(path);
			assert.equal(loaded.receiptHash, receipt.receiptHash);
			assert.equal(loaded.analysisHash, receipt.analysisHash);
			// No absolute paths or secrets in persisted receipt
			const serialized = JSON.stringify(receipt);
			assert.equal(serialized.includes(root), false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
