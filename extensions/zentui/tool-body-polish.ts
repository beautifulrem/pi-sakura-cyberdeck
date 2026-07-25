import { visibleWidth } from "@earendil-works/pi-tui";
import { renderSakuraGradient, type RGB } from "./gradient";

export type DiffStats = { added: number; removed: number };

/** Minimal theme surface used for adaptive (light/dark) body colors. */
export type ThemeLike = {
	fg(color: string, text: string): string;
};

const RESET = "\x1b[0m";
const CORAL: RGB = [255, 143, 163];
const MINT: RGB = [174, 229, 197];
const LAVENDER: RGB = [199, 184, 245];
const SKY: RGB = [159, 211, 242];
const MUTED: RGB = [169, 155, 174];
const DIM_RGB: RGB = [113, 104, 121];
const SAKURA: RGB = [242, 167, 198];

export function fg(color: RGB, text: string): string {
	return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m${text}${RESET}`;
}

function themeOr(theme: ThemeLike | undefined, key: string, fallback: RGB, text: string): string {
	if (!theme) return fg(fallback, text);
	try {
		return theme.fg(key, text);
	} catch {
		return fg(fallback, text);
	}
}

export function stripAnsi(text: string): string {
	return text
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

/** Drop Box full-width padding / trailing spaces. */
function plainTrim(text: string): string {
	return text.replace(/[\t ]+$/g, "").replace(/^\s+$/g, "");
}

/** Drop trailing truncator junk only (long lines). Keep real `foo...`. */
function stripTrailingEllipsis(text: string): string {
	const t = text.replace(/[\t ]+$/g, "");
	// Width-truncators leave ... on long padded rows; short code tails stay.
	if (t.length >= 48 && /(?:\u2026|\.\.\.|…)$/u.test(t)) {
		return t.replace(/(?:\u2026|\.\.\.|…)+$/u, "").replace(/[\t ]+$/g, "");
	}
	return t;
}


/**
 * Pi edit-diff lines after stripAnsi:
 *   `-12 text` / `+12 text` / ` 12 text` / `   ...`
 * Box/Text paddingX often prefixes one space — strip that before match.
 */
export function parseDiffLine(
	plain: string,
):
	| { kind: "add" | "del" | "ctx"; lineNum: string; content: string }
	| { kind: "ellipsis" }
	| null {
	// Trim trailing pad; drop a single leading box-pad space (paddingX=1).
	let line = plain.replace(/\s+$/g, "");
	if (line.startsWith(" ") && (line[1] === "+" || line[1] === "-" || line[1] === " ")) {
		line = line.slice(1);
	}
	// Collapsed context marker from edit-diff.js
	if (/^\s*\d*\s*\.{3}$/.test(line) || line.trim() === "...") {
		return { kind: "ellipsis" };
	}
	// Pi native: +12 content  /  -12 content
	const signed = line.match(/^([+-])(\d+) (.*)$/);
	if (signed) {
		return {
			kind: signed[1] === "+" ? "add" : "del",
			lineNum: signed[2] ?? "",
			content: signed[3] ?? "",
		};
	}
	// Loose signed (optional spaces): + 12 content
	const signedLoose = line.match(/^([+-])\s+(\d+)\s+(.*)$/);
	if (signedLoose) {
		return {
			kind: signedLoose[1] === "+" ? "add" : "del",
			lineNum: signedLoose[2] ?? "",
			content: signedLoose[3] ?? "",
		};
	}
	// Context: leading spaces + line number + content
	const ctx = line.match(/^\s*(\d+) (.*)$/);
	if (ctx) {
		return { kind: "ctx", lineNum: ctx[1] ?? "", content: ctx[2] ?? "" };
	}
	return null;
}

export function looksLikeDiffBlock(plains: readonly string[]): boolean {
	let signed = 0;
	let related = 0;
	for (const plain of plains) {
		const parsed = parseDiffLine(plain);
		if (!parsed) continue;
		if (parsed.kind === "add" || parsed.kind === "del") signed += 1;
		else related += 1;
	}
	return signed >= 1 && signed + related >= 2;
}

export function collectDiffStats(plains: readonly string[]): DiffStats {
	let added = 0;
	let removed = 0;
	for (const plain of plains) {
		const parsed = parseDiffLine(plain);
		if (parsed?.kind === "add") added += 1;
		if (parsed?.kind === "del") removed += 1;
	}
	return { added, removed };
}

function padLineNum(lineNum: string, width: number): string {
	if (!lineNum) return " ".repeat(width);
	return lineNum.padStart(width, " ");
}

function maxLineNumWidth(plains: readonly string[]): number {
	let max = 1;
	for (const plain of plains) {
		const parsed = parseDiffLine(plain);
		if (!parsed || parsed.kind === "ellipsis") continue;
		max = Math.max(max, parsed.lineNum.length || 1);
	}
	return max;
}

function styleToolTitle(plain: string, theme?: ThemeLike): string | null {
	const dollar = plain.match(/^\$\s+(.+)$/);
	if (dollar) {
		return `${themeOr(theme, "bashMode", MINT, "❯")} ${themeOr(theme, "toolTitle", SKY, dollar[1] ?? "")}`;
	}

	// Builtins + snake_case extension tools (xai_grok_run_terminal_command, etc.)
	const match = plain.match(
		/^(edit|write|read|bash|grep|find|ls|ffgrep|fffind|search_replace|run_terminal_command|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b(\s+.*)?$/i,
	);
	if (!match) return null;
	const rawName = match[1] ?? "";
	const rest = (match[2] ?? "").trim();
	// No leading glyph — border already has status chrome; keep body consistent.
	const title = renderSakuraGradient(rawName);
	if (!rest) return title;
	// Path in sakura so it matches repeated path lines below (same content, same color).
	return `${title}  ${themeOr(theme, "accent", SAKURA, rest)}`;
}

/**
 * Delta-inspired gutter:
 *   │ 12 │ context
 *   │ 13 │- removed   (coral marker in gutter, body coral)
 *   │ 13 │+ added     (mint marker in gutter, body mint)
 */
function styleDiffLine(
	parsed: Exclude<ReturnType<typeof parseDiffLine>, null>,
	numWidth: number,
	theme?: ThemeLike,
): string {
	// Keep Pi-native shape: ±12 content  /  12 content  (no extra │ gutters — they ate width and caused ...)
	if (parsed.kind === "ellipsis") {
		return themeOr(theme, "dim", DIM_RGB, ` ${" ".repeat(numWidth)} ···`);
	}

	const num = padLineNum(parsed.lineNum, numWidth);
	if (parsed.kind === "add") {
		return (
			themeOr(theme, "toolDiffAdded", MINT, `+${num} `) +
			themeOr(theme, "toolDiffAdded", MINT, parsed.content)
		);
	}
	if (parsed.kind === "del") {
		return (
			themeOr(theme, "toolDiffRemoved", CORAL, `-${num} `) +
			themeOr(theme, "toolDiffRemoved", CORAL, parsed.content)
		);
	}
	return (
		themeOr(theme, "toolDiffContext", MUTED, ` ${num} `) +
		themeOr(theme, "toolDiffContext", MUTED, parsed.content)
	);
}

/** Absolute / home / relative path-ish lines (same content as tool title rest). */
function looksLikePathLine(plain: string): boolean {
	const s = plain.trim();
	if (!s || s.length > 400) return false;
	if (/\s{2,}/.test(s)) return false; // multi-column dumps
	if (/^(error|Error|FAILED|Successfully|Wrote)\b/.test(s)) return false;
	// /abs, ~/home, ./rel, ../rel, or file.ext
	if (/^(?:~\/?|\.\.?\/|\/)\S+$/.test(s)) return true;
	if (/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(s)) return true;
	if (/\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|rs|go|css|html|sh|toml|yaml|yml)$/i.test(s) && !/\s/.test(s)) {
		return true;
	}
	return false;
}

function stylePathLine(plain: string, theme?: ThemeLike): string {
	const s = plain.trim();
	// Leading glyph + sakura path so sibling lines match the title row accent.
	return `${themeOr(theme, "dim", DIM_RGB, "›")} ${themeOr(theme, "accent", SAKURA, s)}`;
}

function styleGenericBodyLine(plain: string, original: string, theme?: ThemeLike): string {
	if (!plain) return original;
	if (/^(error|Error|FAILED|failed)\b/.test(plain)) {
		return `${themeOr(theme, "error", CORAL, "×")} ${themeOr(theme, "error", CORAL, plain)}`;
	}
	if (/^(Successfully|Wrote|ok|complete)\b/i.test(plain)) {
		return `${themeOr(theme, "success", MINT, "✓")} ${themeOr(theme, "success", MINT, plain)}`;
	}
	// Always restyle from plain — full-width Box ANSI lines cause right-edge "..." when re-boxed.
	const titled = styleToolTitle(plain.trim(), theme);
	if (titled) return titled;
	if (looksLikePathLine(plain)) return stylePathLine(plain, theme);

	// key: value / key=value soft accent
	const kv = plain.match(/^([A-Za-z_][\w.-]*)(\s*[:=]\s*)(.*)$/);
	if (kv) {
		return (
			themeOr(theme, "syntaxVariable", LAVENDER, kv[1] ?? "") +
			themeOr(theme, "dim", DIM_RGB, kv[2] ?? "") +
			themeOr(theme, "toolOutput", MUTED, kv[3] ?? "")
		);
	}

	return themeOr(theme, "toolOutput", MUTED, plain);
}

export function beautifyToolBody(
	lines: readonly string[],
	theme?: ThemeLike,
): { lines: string[]; stats: DiffStats } {
	const plains = lines.map((line) => stripAnsi(line));
	const stats = collectDiffStats(plains);
	const isDiff = looksLikeDiffBlock(plains);
	const numWidth = isDiff ? maxLineNumWidth(plains) : 1;
	const out: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const original = lines[i] ?? "";
		// Box pads every line to full terminal width; always restyle from trimmed plain
		// so we never re-box a full-width predecessor line (that caused right-edge "...").
		// plainTrim drops trailing pad; strip one leading Box paddingX space so parseDiffLine
		// and titles see Pi-native text (not " -12 ..." / " title").
		let plain = stripTrailingEllipsis(plainTrim(plains[i] ?? ""));
		if (plain.startsWith(" ") && plain.length > 1) {
			// Keep intentional indent (2+ spaces); only peel single box pad.
			if (plain[1] !== " ") plain = plain.slice(1);
		}
		if (!plain) {
			if (out.length > 0 && out[out.length - 1] !== "") out.push("");
			continue;
		}

		const titled = styleToolTitle(plain, theme);
		if (titled) {
			out.push(titled);
			continue;
		}

		if (isDiff) {
			const parsed = parseDiffLine(plain);
			if (parsed) {
				out.push(styleDiffLine(parsed, numWidth, theme));
				continue;
			}
		}

		// Pass plain as original too — never keep full-width ANSI padding lines.
		out.push(styleGenericBodyLine(plain, plain, theme));
	}

	// Trim trailing blank
	while (out.length > 0 && out[out.length - 1] === "") out.pop();

	return { lines: out, stats };
}


/** Collapsed tool body budget — big heredocs/JSON args used to paint hundreds of lines. */
export const TOOL_COLLAPSED_MAX_LINES = 12;
export const TOOL_COLLAPSED_MAX_LINE_CHARS = 160;
export const TOOL_HEREDOC_HEAD_LINES = 3;

function isHeredocOrHugeWrite(plains: readonly string[]): boolean {
	const joined = plains.join("\n");
	if (/<<\s*['"]?EOF['"]?/.test(joined)) return true;
	if (/cat\s+>/.test(joined) && plains.length > 20) return true;
	// Giant JSON args blob (common for write/run_terminal_command)
	if (plains.some((p) => p.trimStart().startsWith("{") && p.length > 200)) return true;
	return plains.length > 40;
}

function summarizeHugePayload(
	plains: readonly string[],
	theme?: ThemeLike,
	options: { skipCmd?: string } = {},
): string[] {
	const first = plains.find((p) => p.trim()) ?? "";
	// Prefer command / path from first few lines
	const cmd = plains.slice(0, 6).find((p) => /\b(cat|tee|write|edit|node|python|bash)\b/.test(p)) ?? first;
	const pathMatch = plains.join("\n").match(/(?:[>~]?\/|\.\/)[^\s'"]+\.(?:ts|tsx|js|json|md|py|sh)/);
	const path = pathMatch?.[0];
	const bytes = plains.join("\n").length;
	const lines = plains.length;
	const head: string[] = [themeOr(theme, "dim", DIM_RGB, "▾ collapsed large payload")];
	// Skip cmd when it duplicates the title line already shown above.
	const skip = (options.skipCmd ?? "").trim();
	if (cmd.trim() && cmd.trim() !== skip) {
		const titled = styleToolTitle(cmd.trim(), theme);
		head.push(
			titled ??
				themeOr(theme, "toolTitle", SKY, truncatePlain(cmd.trim(), TOOL_COLLAPSED_MAX_LINE_CHARS)),
		);
	}
	if (path) head.push(stylePathLine(path, theme));
	head.push(themeOr(theme, "dim", DIM_RGB, `${lines} lines · ~${Math.round(bytes / 1024)}KB · expand to show`));
	return head;
}

function truncatePlain(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Cap tool card body when collapsed. Expanded respects full polished body.
 * Prevents heredoc / full-file dumps from freezing the TUI.
 */
export function compactToolBody(
	lines: readonly string[],
	options: { expanded?: boolean; theme?: ThemeLike } = {},
): string[] {
	const theme = options.theme;
	if (options.expanded) {
		// Still hard-cap pathological monsters even when expanded.
		const HARD = 200;
		if (lines.length <= HARD) return [...lines];
		const head = lines.slice(0, HARD);
		const more = lines.length - HARD;
		return [...head, themeOr(theme, "dim", DIM_RGB, `… +${more} lines truncated`)];
	}

	const plains = lines.map((l) => stripAnsi(l));
	if (isHeredocOrHugeWrite(plains)) {
		// Restyle title so it matches macaron chrome (drop foreign cyan ANSI).
		const firstPlain = lines[0] ? stripAnsi(lines[0]).trim() : "";
		const titleLine =
			firstPlain && !firstPlain.includes("{")
				? styleToolTitle(firstPlain, theme) ??
					themeOr(theme, "toolTitle", SKY, firstPlain)
				: undefined;
		const title = titleLine ? [titleLine] : [];
		return [...title, ...summarizeHugePayload(plains, theme, { skipCmd: firstPlain })];
	}

	const out: string[] = [];
	let count = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const plain = stripAnsi(line);
		if (!plain.trim()) {
			if (out.length && out[out.length - 1] !== "") out.push("");
			continue;
		}
		if (count >= TOOL_COLLAPSED_MAX_LINES) {
			const remaining = lines.length - i;
			out.push(themeOr(theme, "dim", DIM_RGB, `… +${Math.max(1, remaining)} more · expand`));
			break;
		}
		// Truncate absurd single-line JSON / command blobs
		if (plain.length > TOOL_COLLAPSED_MAX_LINE_CHARS) {
			const cut = truncatePlain(plain, TOOL_COLLAPSED_MAX_LINE_CHARS);
			out.push(line.includes("\x1b[") ? themeOr(theme, "toolOutput", MUTED, cut) : styleGenericBodyLine(cut, cut, theme));
		} else {
			out.push(line);
		}
		count += 1;
	}
	while (out.length && out[out.length - 1] === "") out.pop();
	return out;
}

export function formatStats(stats: DiffStats): string {
	const parts: string[] = [];
	if (stats.added > 0) parts.push(`+${stats.added}`);
	if (stats.removed > 0) parts.push(`−${stats.removed}`);
	return parts.join(" ");
}

/** Kept for callers; intentionally unused in the quieter card chrome. */
export function renderStatsChip(stats: DiffStats, theme?: ThemeLike): string | undefined {
	if (stats.added <= 0 && stats.removed <= 0) return undefined;
	const add = stats.added > 0 ? themeOr(theme, "toolDiffAdded", MINT, `+${stats.added}`) : "";
	const del = stats.removed > 0 ? themeOr(theme, "toolDiffRemoved", CORAL, `−${stats.removed}`) : "";
	const sep = add && del ? themeOr(theme, "dim", DIM_RGB, " ") : "";
	return `${themeOr(theme, "thinkingXhigh", LAVENDER, "Δ")} ${add}${sep}${del}`;
}

export function fitBorderLabel(label: string, width: number): string {
	if (width <= 0) return "";
	if (width === 1) return "╭";
	const innerWidth = Math.max(0, width - 2);
	let result = "";
	let used = 0;
	const lead = `─ ${label} `;
	for (const char of lead) {
		const w = visibleWidth(char);
		if (used + w > innerWidth) break;
		result += char;
		used += w;
	}
	return `╭${result}${"─".repeat(Math.max(0, innerWidth - used))}╮`;
}

export function bottomBorder(width: number): string {
	if (width <= 0) return "";
	if (width === 1) return "╰";
	return `╰${"─".repeat(Math.max(0, width - 2))}╯`;
}
