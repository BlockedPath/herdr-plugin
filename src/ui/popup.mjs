#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

function workspaceRoot() {
	return (
		process.env.HERDR_WORKSPACE_ROOT ??
		process.env.HERDR_PANE_CWD ??
		process.cwd()
	);
}

function gitLog(root) {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["log", "--oneline", "-20", "--color=never"], {
			cwd: root,
			shell: false,
		});
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (err += d));
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve(out)
				: reject(new Error(err || `git log exited ${code}`)),
		);
	});
}

function gitShow(root, hash) {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["show", "--stat", hash], {
			cwd: root,
			shell: false,
		});
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		child.on("error", reject);
		child.on("close", () => resolve(out));
	});
}

const root = workspaceRoot();
let log = "";
try {
	log = await gitLog(root);
} catch (e) {
	process.stdout.write(
		`Herdr Mixtape — ${root}\n\nNot a git repo or no commits: ${e instanceof Error ? e.message : String(e)}\n\n[q] quit\n`,
	);
	process.exit(0);
}

const tracks = log
	.trim()
	.split("\n")
	.filter(Boolean)
	.map((line) => {
		const sp = line.indexOf(" ");
		return { hash: line.slice(0, sp), message: line.slice(sp + 1) };
	});

const title = root.split("/").pop() || "herdr";
const date = new Date().toISOString().slice(0, 10);

// ASCII mixtape cover
const cover = [
	"┌──────────────────────────────────────┐",
	`│  HERDR MIXTAPE: ${title.padEnd(22).slice(0, 22)} │`,
	`│  ${date}                     │`,
	`│                                      │`,
	`│   ██████  ██   ██  ██████             │`,
	`│   ██      ██   ██  ██                 │`,
	`│   ██      ███████  █████              │`,
	`│   ██      ██   ██  ██                 │`,
	`│   ██████  ██   ██  ██ Vol.1          │`,
	"└──────────────────────────────────────┘",
];

process.stdout.write(cover.join("\n") + "\n\n");
process.stdout.write(
	`Side A — ${tracks.slice(0, 10).length} tracks  |  Side B — ${tracks.slice(10).length} tracks\n\n`,
);
tracks.forEach((t, i) => {
	const side = i < 10 ? "A" : "B";
	const num = i < 10 ? i + 1 : i - 9;
	process.stdout.write(
		`${side}${num}. ${t.message.slice(0, 60)}  [${t.hash.slice(0, 7)}]\n`,
	);
});
process.stdout.write(
	"\n[Enter number] play (git show)  [c] copy tracklist  [s] save png (Kitty)  [q] quit\n",
);

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", async (line) => {
	const v = line.trim().toLowerCase();
	if (v === "q") {
		rl.close();
		process.exit(0);
	}
	if (v === "c") {
		const list = tracks
			.map((t, i) => `${i + 1}. ${t.message} (${t.hash})`)
			.join("\n");
		process.stdout.write("\n" + list + "\n\n");
		return;
	}
	if (v === "s") {
		try {
			const png = generateMixtapePng(title, date, tracks);
			const outPath = join(tmpdir(), `herdr-mixtape-${date}-${Date.now()}.png`);
			await writeFile(outPath, png);
			// Try Kitty graphics protocol (works in Kitty, Ghostty, etc.), fallback to path
			const b64 = png.toString("base64");
			process.stdout.write(
				`\x1b_Gf=100,a=T,t=d,s=${800},v=${600};${b64}\x1b\\\n`,
			);
			process.stdout.write(`\nSaved PNG to ${outPath}\n`);
			if (process.platform === "darwin") {
				process.stdout.write("Run: open " + outPath + "\n\n");
			}
		} catch (e) {
			process.stdout.write(
				`\nPNG export failed: ${e instanceof Error ? e.message : String(e)}\n\n`,
			);
		}
		return;
	}
	const n = Number.parseInt(v, 10);
	if (!Number.isNaN(n) && n >= 1 && n <= tracks.length) {
		playClick();
		const track = tracks[n - 1];
		const show = await gitShow(root, track.hash);
		process.stdout.write("\n" + show.slice(0, 4000) + "\n\n");
	}
});
process.on("SIGINT", () => {
	rl.close();
	process.exit(0);
});

function generateMixtapePng(title, date, tracks) {
	const W = 800;
	const H = 600;
	const bg = 255;
	const fg = 0;
	const data = Buffer.alloc((W * 3 + 1) * H, bg);
	// filter byte per row already 0 (via alloc bg, but first byte of each row must be 0)
	for (let y = 0; y < H; y++) data[y * (W * 3 + 1)] = 0;
	// fill white (overwrites filter bytes set to 0, but we need white after filter)
	for (let y = 0; y < H; y++) {
		const rowStart = y * (W * 3 + 1);
		for (let x = 0; x < W; x++) {
			const off = rowStart + 1 + x * 3;
			data[off] = 255;
			data[off + 1] = 255;
			data[off + 2] = 255;
		}
	}
	function setPixel(x, y, v) {
		if (x < 0 || x >= W || y < 0 || y >= H) return;
		const off = y * (W * 3 + 1) + 1 + x * 3;
		data[off] = v;
		data[off + 1] = v;
		data[off + 2] = v;
	}
	function drawChar(x, y, ch, scale = 2) {
		const glyph = FONT[ch] ?? FONT["?"];
		if (!glyph) return;
		for (let row = 0; row < 7; row++) {
			for (let col = 0; col < 5; col++) {
				if ((glyph[row] >> (4 - col)) & 1) {
					for (let dy = 0; dy < scale; dy++)
						for (let dx = 0; dx < scale; dx++)
							setPixel(x + col * scale + dx, y + row * scale + dy, fg);
				}
			}
		}
	}
	function drawText(x, y, text, scale = 2) {
		let cx = x;
		for (const ch of text) {
			drawChar(cx, y, ch, scale);
			cx += 6 * scale;
		}
	}
	// cover
	drawText(40, 40, `HERDR MIXTAPE: ${title.slice(0, 22)}`, 3);
	drawText(40, 80, date, 2);
	drawText(40, 120, "Side A  |  Side B", 2);
	let ty = 160;
	for (let i = 0; i < Math.min(tracks.length, 14); i++) {
		const t = tracks[i];
		const side = i < 7 ? "A" : "B";
		const num = i < 7 ? i + 1 : i - 6;
		drawText(40, ty, `${side}${num}. ${t.message.slice(0, 32)}`, 2);
		ty += 22;
		if (ty > H - 30) break;
	}
	return createPng(W, H, data);
}

function createPng(width, height, raw) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // truecolor
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	const idat = deflateSync(raw);
	return Buffer.concat([
		pngHeader(),
		chunk("IHDR", ihdr),
		chunk("IDAT", idat),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function pngHeader() {
	return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const t = Buffer.from(type);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
	return Buffer.concat([len, t, data, crc]);
}

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[i] = c >>> 0;
	}
	return t;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function playClick() {
	process.stdout.write("\x07");
	try {
		const p = spawn("afplay", ["/System/Library/Sounds/Glass.aiff", "-v", "10"], {
			stdio: "ignore",
			detached: true,
		});
		p.unref();
		return;
	} catch {}
	try {
		const p = spawn("afplay", ["/System/Library/Sounds/Pop.aiff", "-v", "10"], {
			stdio: "ignore",
			detached: true,
		});
		p.unref();
		return;
	} catch {}
	try {
		const p = spawn("osascript", ["-e", "beep"], { stdio: "ignore", detached: true });
		p.unref();
		return;
	} catch {}
	try {
		const p = spawn(
			"paplay",
			["/usr/share/sounds/freedesktop/stereo/message.oga"],
			{ stdio: "ignore", detached: true },
		);
		p.unref();
	} catch {}
}

const FONT = {
	" ": [0, 0, 0, 0, 0, 0, 0],
	"!": [0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100],
	'"': [0b01010, 0b01010, 0, 0, 0, 0, 0],
	"#": [0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0, 0],
	$: [0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100],
	"%": [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011],
	"&": [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
	"'": [0b00100, 0b00100, 0, 0, 0, 0, 0],
	"(": [0b00100, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b00100],
	")": [0b00100, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b00100],
	"*": [0b00000, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0],
	"+": [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
	",": [0, 0, 0, 0, 0, 0b00100, 0b01000],
	"-": [0, 0, 0, 0b11111, 0, 0, 0],
	".": [0, 0, 0, 0, 0, 0b00100, 0b00100],
	"/": [0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0, 0],
	0: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
	1: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
	2: [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
	3: [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
	4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
	5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
	6: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
	7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
	8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
	9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
	":": [0, 0b00100, 0b00100, 0, 0b00100, 0b00100, 0],
	";": [0, 0b00100, 0b00100, 0, 0b00100, 0b00100, 0b01000],
	"<": [0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010],
	"=": [0, 0, 0b11111, 0, 0b11111, 0, 0],
	">": [0b10000, 0b01000, 0b00100, 0b00010, 0b00100, 0b01000, 0b10000],
	"?": [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0, 0b00100],
	"@": [0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110],
	A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
	B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
	C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
	D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
	E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
	F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
	G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
	H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
	I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
	J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
	K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
	L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
	M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
	N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
	O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
	P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
	Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
	R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
	S: [0b01110, 0b10001, 0b10000, 0b01110, 0b00001, 0b10001, 0b01110],
	T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
	U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
	V: [0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b01010, 0b00100],
	W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
	X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
	Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
	Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
	"[": [0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110],
	"\\": [0b10000, 0b01000, 0b00100, 0b00010, 0b00001, 0, 0],
	"]": [0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110],
	"^": [0b00100, 0b01010, 0b10001, 0, 0, 0, 0],
	_: [0, 0, 0, 0, 0, 0, 0b11111],
	"`": [0b01000, 0b00100, 0, 0, 0, 0, 0],
	a: [0, 0, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111],
	b: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b11110],
	c: [0, 0, 0b01110, 0b10000, 0b10000, 0b10001, 0b01110],
	d: [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10001, 0b01111],
	e: [0, 0, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110],
	f: [0b00110, 0b01001, 0b01000, 0b11110, 0b01000, 0b01000, 0b01000],
	g: [0, 0, 0b01111, 0b10001, 0b01111, 0b00001, 0b01110],
	h: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
	i: [0b00100, 0, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110],
	j: [0b00010, 0, 0b00110, 0b00010, 0b00010, 0b00010, 0b01100],
	k: [0b10000, 0b10000, 0b10110, 0b11000, 0b10110, 0b10010, 0b10001],
	l: [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
	m: [0, 0, 0b11010, 0b10101, 0b10101, 0b10101, 0b10001],
	n: [0, 0, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
	o: [0, 0, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110],
	p: [0, 0, 0b11110, 0b10001, 0b11110, 0b10000, 0b10000],
	q: [0, 0, 0b01111, 0b10001, 0b01111, 0b00001, 0b00001],
	r: [0, 0, 0b10111, 0b11001, 0b10000, 0b10000, 0b10000],
	s: [0, 0, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
	t: [0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00101, 0b00010],
	u: [0, 0, 0b10001, 0b10001, 0b10001, 0b10001, 0b01111],
	v: [0, 0, 0b10001, 0b10001, 0b01010, 0b01010, 0b00100],
	w: [0, 0, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
	x: [0, 0, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001],
	y: [0, 0, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
	z: [0, 0, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111],
	"{": [0b00010, 0b00100, 0b00100, 0b01000, 0b00100, 0b00100, 0b00010],
	"|": [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
	"}": [0b01000, 0b00100, 0b00100, 0b00010, 0b00100, 0b00100, 0b01000],
	"~": [0b01010, 0b10101, 0, 0, 0, 0, 0],
};
