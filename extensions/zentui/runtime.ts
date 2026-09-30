import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

const VERSION_TIMEOUT_MS = 2_000;

export type RuntimeInfo = {
	name: string;
	symbol: string;
	style: string;
	version?: string;
};

export type RuntimeReadResult = { kind: "ok"; runtime?: RuntimeInfo } | { kind: "error" };

type RuntimeDef = Omit<RuntimeInfo, "version"> & {
	/** Any of these files in cwd selects the runtime (first matching runtime wins). */
	markers: readonly string[];
	/** One version command, run once with `cwd` set so version managers see local pins. */
	command: string;
	args: readonly string[];
	pattern: RegExp;
};

/**
 * Version-manager pin files. Their mtimes are part of the cache key so
 * `nvm use` / `pyenv local` / `mise use` / `rustup override` in the project
 * refreshes the displayed version on the next scan.
 */
const VERSION_PIN_FILES = [
	".nvmrc",
	".node-version",
	".python-version",
	".ruby-version",
	".java-version",
	".go-version",
	".tool-versions",
	".mise.toml",
	"mise.toml",
	"rust-toolchain",
	"rust-toolchain.toml",
] as const;

const PYTHON_COMMAND = process.platform === "win32" ? "python" : "python3";

// Order is priority: bun/deno projects also carry package.json.
const RUNTIMES: readonly RuntimeDef[] = [
	{
		name: "bun",
		symbol: "\u{e76f}",
		style: "bold red",
		markers: ["bun.lock", "bun.lockb", "bunfig.toml"],
		command: "bun",
		args: ["--version"],
		pattern: /^v?(\d[^\s]*)/,
	},
	{
		name: "deno",
		symbol: "\u{e7c0}",
		style: "green bold",
		markers: ["deno.json", "deno.jsonc", "deno.lock"],
		command: "deno",
		args: ["--version"],
		pattern: /deno\s+(\d[^\s]*)/i,
	},
	{
		name: "nodejs",
		symbol: "\u{e718}",
		style: "bold green",
		markers: ["package.json", ".nvmrc", ".node-version"],
		command: "node",
		args: ["--version"],
		pattern: /^v?(\d[^\s]*)/,
	},
	{
		name: "python",
		symbol: "\u{e235}",
		style: "yellow bold",
		markers: [
			"pyproject.toml",
			"requirements.txt",
			".python-version",
			"Pipfile",
			"setup.py",
			"setup.cfg",
		],
		command: PYTHON_COMMAND,
		args: ["--version"],
		pattern: /Python\s+(\d[^\s]*)/i,
	},
	{
		name: "golang",
		symbol: "\u{e627}",
		style: "bold cyan",
		markers: ["go.mod", "go.work"],
		command: "go",
		args: ["version"],
		pattern: /go version go(\d[^\s]*)/i,
	},
	{
		name: "rust",
		symbol: "\u{f1617}",
		style: "bold red",
		markers: ["Cargo.toml", "rust-toolchain", "rust-toolchain.toml"],
		command: "rustc",
		args: ["--version"],
		pattern: /rustc\s+(\d[^\s]*)/i,
	},
	{
		name: "ruby",
		symbol: "\u{e791}",
		style: "bold red",
		markers: ["Gemfile", ".ruby-version"],
		command: "ruby",
		args: ["--version"],
		pattern: /ruby\s+(\d[^\s]*)/i,
	},
	{
		name: "java",
		symbol: "\u{e738}",
		style: "red dimmed",
		markers: ["pom.xml", "build.gradle", "build.gradle.kts", ".java-version"],
		command: "java",
		args: ["-version"],
		pattern: /version\s+"?(\d[^\s"]*)/i,
	},
];

const RUNTIME_CACHE_MAX = 16;
const runtimeInfoCache = new Map<string, { key: string; runtime: RuntimeInfo | undefined }>();

function fileMtime(cwd: string, name: string): number | undefined {
	try {
		const stat = statSync(join(cwd, name), { throwIfNoEntry: false });
		return stat ? stat.mtimeMs : undefined;
	} catch {
		return undefined;
	}
}

/** Pick the runtime whose marker file exists; `exists` is injectable for tests. */
export function detectRuntime(
	exists: (name: string) => boolean,
): Omit<RuntimeDef, "markers"> | undefined {
	return RUNTIMES.find((runtime) => runtime.markers.some(exists));
}

function runVersion(def: Omit<RuntimeDef, "markers">, cwd: string): Promise<string | undefined> {
	return new Promise((resolvePromise) => {
		execFile(
			def.command,
			[...def.args],
			{ cwd, timeout: VERSION_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					resolvePromise(undefined);
					return;
				}
				// `java -version` prints to stderr.
				const match = `${String(stdout)}\n${String(stderr)}`.trim().match(def.pattern);
				resolvePromise(match?.[1] ? `v${match[1]}` : undefined);
			},
		);
	});
}

/**
 * Detect the project runtime in `cwd` and read its version. Cached per cwd; the
 * cache key covers which marker files exist plus version-pin mtimes, so the
 * subprocess runs once per project state instead of on every refresh.
 */
export async function readRuntimeInfo(cwd: string): Promise<RuntimeReadResult> {
	try {
		const seen = new Map<string, number | undefined>();
		const mtime = (name: string) => {
			if (!seen.has(name)) seen.set(name, fileMtime(cwd, name));
			return seen.get(name);
		};
		const def = detectRuntime((name) => mtime(name) !== undefined);
		const pins = VERSION_PIN_FILES.map((name) => `${name}:${mtime(name) ?? "-"}`).join("|");
		const key = `${def?.name ?? "-"}|${pins}`;
		const cached = runtimeInfoCache.get(cwd);
		if (cached?.key === key) return { kind: "ok", runtime: cached.runtime };

		const runtime: RuntimeInfo | undefined = def
			? {
					name: def.name,
					symbol: def.symbol,
					style: def.style,
					version: await runVersion(def, cwd),
				}
			: undefined;
		runtimeInfoCache.delete(cwd);
		runtimeInfoCache.set(cwd, { key, runtime });
		while (runtimeInfoCache.size > RUNTIME_CACHE_MAX) {
			const oldest = runtimeInfoCache.keys().next().value;
			if (oldest === undefined) break;
			runtimeInfoCache.delete(oldest);
		}
		return { kind: "ok", runtime };
	} catch {
		return { kind: "error" };
	}
}
