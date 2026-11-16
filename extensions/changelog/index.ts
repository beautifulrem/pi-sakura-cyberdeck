// `/sakura-changelog` — scrollable viewer for this pack's changelog.
//
// After an update, Pi itself shows the new entries under "Extension Updates" (it reads
// the root CHANGELOG.md, or `pi.changelogPath`), records the seen version, and honours
// the `collapseChangelog` setting — so this extension no longer keeps its own notice or
// state file. `/sakura-changelog` remains useful because Pi's `/changelog` only shows
// Pi's own changelog, never package changelogs.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

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

export type Paint = Pick<Theme, "fg" | "bold">;

// ---------------------------------------------------------------------------
// Files

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
	private readonly entries: ChangelogEntry[];
	private readonly theme: Theme;
	private readonly rows: () => number;
	private readonly requestRender: () => void;
	private readonly done: () => void;

	constructor(
		entries: ChangelogEntry[],
		theme: Theme,
		rows: () => number,
		requestRender: () => void,
		done: () => void,
	) {
		this.entries = entries;
		this.theme = theme;
		this.rows = rows;
		this.requestRender = requestRender;
		this.done = done;
	}

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
	const mode = (ctx as { mode?: string }).mode;
	return mode ? mode === "tui" : ctx.hasUI;
}

export default function sakuraChangelog(pi: ExtensionAPI) {
	pi.registerCommand("sakura-changelog", {
		description: "Show the pi-sakura-cyberdeck changelog (optionally for one version)",
		handler: async (args, ctx) => {
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
				const plain = renderChangelogLines(entries, 100, { fg: (_c: string, t: string) => t, bold: (t: string) => t });
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
