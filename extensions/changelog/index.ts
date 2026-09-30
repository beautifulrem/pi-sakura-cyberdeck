// What's-new notice for pi-sakura-cyberdeck.
// After an install or `pi update`, the first interactive session shows the new
// version's highlights above the editor (hidden again on the next message).
// `/sakura-changelog` opens the full, scrollable changelog at any time.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const WIDGET_KEY = "sakura-cyberdeck-changelog";
const STATE_FILE = "sakura-cyberdeck-state.json";
const MAX_NOTICE_BULLETS = 10;

export interface ChangelogSection {
	title: string;
	lines: string[];
}

export interface ChangelogEntry {
	version: string;
	date?: string;
	sections: ChangelogSection[];
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------------------------------------------------------------------------
// Parsing (pure)

/** Parses `## [1.2.0] - 2026-09-30` / `## 1.2.0` headings with `###` sections and `-` bullets. */
export function parseChangelog(markdown: string): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	let entry: ChangelogEntry | undefined;
	let section: ChangelogSection | undefined;
	for (const raw of markdown.split(/\r?\n/)) {
		const line = raw.trimEnd();
		const heading = line.match(/^##\s+\[?v?(\d+\.\d+\.\d+[^\]\s]*)\]?(?:\s+[-–—]\s+(.+))?\s*$/);
		if (heading) {
			entry = { version: heading[1]!, date: heading[2]?.trim(), sections: [] };
			section = undefined;
			entries.push(entry);
			continue;
		}
		if (!entry) continue;
		if (/^#\s/.test(line) || /^##\s/.test(line)) {
			entry = undefined;
			continue;
		}
		const sub = line.match(/^###\s+(.+)$/);
		if (sub) {
			section = { title: sub[1]!.trim(), lines: [] };
			entry.sections.push(section);
			continue;
		}
		if (!line.trim()) continue;
		if (!section) {
			section = { title: "", lines: [] };
			entry.sections.push(section);
		}
		section.lines.push(line);
	}
	return entries;
}

export function compareVersions(a: string, b: string): number {
	const pa = a.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
	const pb = b.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return Math.sign(diff);
	}
	return 0;
}

/** Entries newer than `lastSeen` and not newer than `current`, newest first. */
export function unseenEntries(
	entries: ChangelogEntry[],
	lastSeen: string | undefined,
	current: string,
): ChangelogEntry[] {
	return entries
		.filter((e) => compareVersions(e.version, current) <= 0)
		.filter((e) => !lastSeen || compareVersions(e.version, lastSeen) > 0)
		.sort((a, b) => compareVersions(b.version, a.version));
}

function stripInlineMarkdown(text: string): string {
	return text
		.replace(/\*\*(.+?)\*\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function isBullet(line: string): boolean {
	return /^\s*[-*]\s+/.test(line);
}

function bulletText(line: string): string {
	return stripInlineMarkdown(line.replace(/^\s*[-*]\s+/, ""));
}

function countBullets(entry: ChangelogEntry): number {
	// Highlights repeat items listed in the other sections.
	return entry.sections
		.filter((s) => !/highlight/i.test(s.title))
		.reduce((n, s) => n + s.lines.filter((l) => isBullet(l) && !/^\s{2,}/.test(l)).length, 0);
}

// ---------------------------------------------------------------------------
// Rendering (pure apart from the theme callbacks)

type Paint = Pick<Theme, "fg" | "bold">;

/** Full changelog lines (used by the scrollable viewer). */
export function renderChangelogLines(entries: ChangelogEntry[], width: number, theme: Paint): string[] {
	const out: string[] = [];
	const wrap = (text: string, indent: string, hanging: string) => {
		const body = wrapTextWithAnsi(text, Math.max(10, width - hanging.length));
		body.forEach((part, index) => out.push(`${index === 0 ? indent : hanging}${part}`));
	};
	for (const entry of entries) {
		if (out.length) out.push("");
		out.push(theme.bold(theme.fg("accent", `✿ ${entry.version}`)) + (entry.date ? theme.fg("dim", `  ${entry.date}`) : ""));
		for (const section of entry.sections) {
			if (section.title) out.push(theme.fg("mdHeading", `  ${section.title}`));
			for (const line of section.lines) {
				const nested = /^\s{2,}[-*]\s+/.test(line);
				if (isBullet(line)) {
					const indent = nested ? "      " : "    ";
					wrap(`${theme.fg("dim", nested ? "◦" : "•")} ${bulletText(line)}`, indent, `${indent}  `);
				} else {
					wrap(stripInlineMarkdown(line.trim()), "    ", "    ");
				}
			}
		}
	}
	return out.map((line) => truncateToWidth(line, width, ""));
}

/** Compact "what's new" notice shown once after an update. */
export function renderNoticeLines(entries: ChangelogEntry[], width: number, theme: Paint): string[] {
	const latest = entries[0];
	if (!latest) return [];
	const lines: string[] = [];
	const title =
		entries.length > 1
			? `✿ pi-sakura-cyberdeck ${entries[entries.length - 1]!.version} → ${latest.version}`
			: `✿ pi-sakura-cyberdeck ${latest.version}`;
	lines.push(theme.bold(theme.fg("accent", title)) + theme.fg("muted", " · what's new"));

	const highlights = latest.sections.find((s) => /highlight/i.test(s.title));
	const pool = (highlights ? [highlights] : latest.sections).flatMap((s) =>
		s.lines.filter((l) => isBullet(l) && !/^\s{2,}/.test(l)),
	);
	for (const line of pool.slice(0, MAX_NOTICE_BULLETS)) {
		const wrapped = wrapTextWithAnsi(`${theme.fg("dim", "•")} ${bulletText(line)}`, Math.max(10, width - 2));
		wrapped.forEach((part, index) => lines.push(`${index === 0 ? "  " : "    "}${part}`));
	}
	const total = entries.reduce((n, e) => n + countBullets(e), 0);
	lines.push(
		theme.fg(
			"muted",
			`  ${total} changes in total · /sakura-changelog for the full list · hides after your next message`,
		),
	);
	return lines.map((line) => truncateToWidth(line, width, "…"));
}

// ---------------------------------------------------------------------------
// Persistence

function statePath(): string {
	return join(getAgentDir(), STATE_FILE);
}

function readLastSeenVersion(): string | undefined {
	try {
		const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as { lastSeenVersion?: unknown };
		return typeof parsed.lastSeenVersion === "string" ? parsed.lastSeenVersion : undefined;
	} catch {
		return undefined;
	}
}

function writeLastSeenVersion(version: string): void {
	try {
		const path = statePath();
		mkdirSync(dirname(path), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify({ lastSeenVersion: version }, null, 2)}\n`);
		renameSync(tmp, path);
	} catch {
		// Non-fatal: the notice simply shows again next time.
	}
}

function readPackageVersion(): string | undefined {
	try {
		const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
		return typeof pkg.version === "string" ? pkg.version : undefined;
	} catch {
		return undefined;
	}
}

function readChangelog(): ChangelogEntry[] {
	const path = join(packageRoot, "CHANGELOG.md");
	if (!existsSync(path)) return [];
	try {
		return parseChangelog(readFileSync(path, "utf8"));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Scrollable viewer

class ChangelogViewer implements Component {
	private offset = 0;
	private lastWidth = 0;
	private cache: string[] = [];

	constructor(
		private readonly entries: ChangelogEntry[],
		private readonly theme: Theme,
		private readonly rows: () => number,
		private readonly requestRender: () => void,
		private readonly done: () => void,
	) {}

	private pageSize(): number {
		return Math.max(5, Math.min(40, this.rows() - 8));
	}

	handleInput(data: string): void {
		const max = Math.max(0, this.cache.length - this.pageSize());
		if (matchesKey(data, "escape") || data === "q" || matchesKey(data, "return")) {
			this.done();
			return;
		}
		if (matchesKey(data, "up") || data === "k") this.offset -= 1;
		else if (matchesKey(data, "down") || data === "j") this.offset += 1;
		else if (matchesKey(data, "pageUp")) this.offset -= this.pageSize();
		else if (matchesKey(data, "pageDown") || data === " ") this.offset += this.pageSize();
		else if (matchesKey(data, "home") || data === "g") this.offset = 0;
		else if (matchesKey(data, "end") || data === "G") this.offset = max;
		this.offset = Math.max(0, Math.min(max, this.offset));
		this.requestRender();
	}

	render(width: number): string[] {
		if (width !== this.lastWidth) {
			this.cache = renderChangelogLines(this.entries, width, this.theme);
			this.lastWidth = width;
		}
		const size = this.pageSize();
		const visible = this.cache.slice(this.offset, this.offset + size);
		const end = Math.min(this.cache.length, this.offset + size);
		const footer = this.theme.fg(
			"muted",
			`  ${this.offset + 1}-${end}/${this.cache.length} · ↑↓ j/k scroll · PgUp/PgDn · q/Esc close`,
		);
		return [...visible, "", truncateToWidth(footer, width, "…")];
	}

	invalidate(): void {
		this.lastWidth = 0;
	}
}

// ---------------------------------------------------------------------------
// Extension

function isTui(ctx: ExtensionContext): boolean {
	return (ctx as { mode?: string }).mode ? (ctx as { mode?: string }).mode === "tui" : ctx.hasUI;
}

export default function sakuraChangelog(pi: ExtensionAPI) {
	let noticeVisible = false;
	let checkedThisProcess = false;

	const hideNotice = (ctx: ExtensionContext) => {
		if (!noticeVisible) return;
		noticeVisible = false;
		try {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		} catch {
			// UI already disposed.
		}
	};

	pi.on("session_start", (_event, ctx) => {
		if (checkedThisProcess || !ctx.hasUI) return;
		const current = readPackageVersion();
		if (!current) return;
		const lastSeen = readLastSeenVersion();
		if (lastSeen && compareVersions(lastSeen, current) >= 0) {
			checkedThisProcess = true;
			return;
		}
		// No record yet (fresh install, or an update from ≤1.1.6): show just this version.
		const all = readChangelog();
		const unseen = lastSeen
			? unseenEntries(all, lastSeen, current)
			: all.filter((entry) => compareVersions(entry.version, current) === 0);
		checkedThisProcess = true;
		if (!unseen.length) {
			writeLastSeenVersion(current);
			return;
		}
		if (!isTui(ctx)) {
			ctx.ui.notify(`pi-sakura-cyberdeck updated to ${current}. Run /sakura-changelog to see what changed.`, "info");
			writeLastSeenVersion(current);
			return;
		}
		ctx.ui.setWidget(
			WIDGET_KEY,
			(_tui, theme) => ({
				render: (width: number) => [...renderNoticeLines(unseen, width, theme), ""],
				invalidate: () => {},
			}),
			{ placement: "aboveEditor" },
		);
		noticeVisible = true;
		writeLastSeenVersion(current);
	});

	pi.on("input", (_event, ctx) => {
		hideNotice(ctx);
	});
	pi.on("agent_start", (_event, ctx) => hideNotice(ctx));
	pi.on("session_shutdown", (_event, ctx) => hideNotice(ctx));

	pi.registerCommand("sakura-changelog", {
		description: "Show the pi-sakura-cyberdeck changelog (optionally for one version)",
		handler: async (args, ctx) => {
			hideNotice(ctx);
			const all = readChangelog();
			const wanted = args.trim().replace(/^v/, "");
			const entries = wanted ? all.filter((e) => e.version === wanted) : all;
			if (!entries.length) {
				ctx.ui.notify(
					wanted ? `No changelog entry for ${wanted}.` : "Changelog not found in this installation.",
					"warning",
				);
				return;
			}
			if (!isTui(ctx)) {
				const plain = renderChangelogLines(entries, 100, { fg: (_c, t) => t, bold: (t) => t } as Paint);
				ctx.ui.notify(plain.slice(0, 40).join("\n"), "info");
				return;
			}
			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const rows = () => {
					const value = (tui as { terminal?: { rows?: number } }).terminal?.rows;
					return typeof value === "number" && value > 0 ? value : 24;
				};
				return new ChangelogViewer(entries, theme, rows, () => tui.requestRender(), () => done());
			});
		},
	});
}
