/**
 * Project package version (Starship `package` module, common manifests only).
 *
 * Pure file parsing — no shell-outs, no parent-directory traversal, no
 * render-time reads. Supported manifests, in lookup order:
 *   package.json   → nodejs
 *   Cargo.toml     → rust   ([package].version, incl. workspace inheritance)
 *   pyproject.toml → python ([project].version or [tool.poetry].version)
 *   composer.json  → php
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageVersionResult = {
	/** Runtime-style ecosystem key (`nodejs`, `rust`, `python`, `php`). */
	ecosystem: string;
	/** Cleaned version string as authored in the manifest. */
	version: string;
};

export type PackageVersionReadResult =
	| { kind: "ok"; result: PackageVersionResult | null }
	| { kind: "error" };

const MAX_VERSION_LENGTH = 64;
const MAX_MANIFEST_BYTES = 1024 * 1024;
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/**
 * Strip surrounding quotes / leading `v` and reject anything that is not a
 * plausible single-token version. Manifests come from arbitrary repositories,
 * so control characters (ESC/BEL → terminal escape injection), bidi controls,
 * whitespace and markup are all rejected.
 */
export function cleanVersion(value: string | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	let text = value.trim();
	if (text.length >= 2) {
		const first = text[0];
		const last = text[text.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			text = text.slice(1, -1).trim();
		}
	}
	// `v3.2.1` → `3.2.1`, but a bare word like `via` is left alone.
	if (/^[vV]\d/.test(text)) text = text.slice(1);
	if (!text || text.length > MAX_VERSION_LENGTH) return undefined;
	if (CONTROL_CHARS.test(text) || BIDI_CONTROLS.test(text)) return undefined;
	if (/\s/.test(text) || /[{}\\<>"'`]/.test(text)) return undefined;
	return text;
}

function readJsonVersion(raw: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const version = (parsed as Record<string, unknown>).version;
		return typeof version === "string" ? cleanVersion(version) : undefined;
	} catch {
		return undefined;
	}
}

function stripTomlComment(value: string): string {
	let quote = "";
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (quote) {
			if (ch === "\\" && quote === '"') i += 1;
			else if (ch === quote) quote = "";
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === "#") {
			return value.slice(0, i).trim();
		}
	}
	return value.trim();
}

/**
 * Value of `key = …` inside TOML table `[section]` (dotted headers compared
 * literally). Inline tables / multi-line values yield the raw text, which
 * `cleanVersion` then rejects.
 */
function readTomlSectionValue(raw: string, section: string, key: string): string | undefined {
	let inSection = false;
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const header = trimmed.match(/^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/);
		if (header) {
			inSection = header[1] === section;
			continue;
		}
		if (!inSection) continue;
		const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
		if (match?.[1] === key) return stripTomlComment(match[2] ?? "") || undefined;
	}
	return undefined;
}

function parseCargoToml(raw: string): string | undefined {
	const direct = cleanVersion(readTomlSectionValue(raw, "package", "version"));
	if (direct) return direct;
	// `version.workspace = true` (or `version = { workspace = true }`) inherits
	// `[workspace.package].version`.
	const inherited =
		/^\s*true\s*$/.test(readTomlSectionValue(raw, "package", "version.workspace") ?? "") ||
		/workspace\s*=\s*true/.test(readTomlSectionValue(raw, "package", "version") ?? "");
	return inherited
		? cleanVersion(readTomlSectionValue(raw, "workspace.package", "version"))
		: undefined;
}

function parsePyprojectToml(raw: string): string | undefined {
	return (
		cleanVersion(readTomlSectionValue(raw, "project", "version")) ??
		cleanVersion(readTomlSectionValue(raw, "tool.poetry", "version"))
	);
}

const MANIFESTS: readonly {
	file: string;
	ecosystem: string;
	parse: (raw: string) => string | undefined;
}[] = [
	{ file: "package.json", ecosystem: "nodejs", parse: readJsonVersion },
	{ file: "Cargo.toml", ecosystem: "rust", parse: parseCargoToml },
	{ file: "pyproject.toml", ecosystem: "python", parse: parsePyprojectToml },
	{ file: "composer.json", ecosystem: "php", parse: readJsonVersion },
];

function readManifest(path: string): string | undefined {
	try {
		const raw = readFileSync(path, "utf8");
		return raw.length > MAX_MANIFEST_BYTES ? undefined : raw;
	} catch {
		return undefined;
	}
}

export function readPackageVersion(cwd: string): PackageVersionResult | null {
	for (const manifest of MANIFESTS) {
		const raw = readManifest(join(cwd, manifest.file));
		if (raw === undefined) continue;
		const version = manifest.parse(raw);
		if (version) return { ecosystem: manifest.ecosystem, version };
	}
	return null;
}

/**
 * Async wrapper for the project-refresh path. `null` (no manifest) is `ok`
 * so the caller clears the segment; exceptions become `error` (keep last-good).
 */
export async function readPackageVersionResult(cwd: string): Promise<PackageVersionReadResult> {
	try {
		return { kind: "ok", result: readPackageVersion(cwd) };
	} catch {
		return { kind: "error" };
	}
}
