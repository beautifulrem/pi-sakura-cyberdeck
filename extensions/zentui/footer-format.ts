/**
 * Starship-style footer format string parser and renderer.
 *
 * Pure module (no TUI/config imports) so it is fully unit-testable.
 *
 * Supports conditional groups: `( ... )` is dropped when every nested
 * variable (and nested group) renders empty.
 */

type GroupToken = {
	kind: "group";
	tokens: FormatToken[];
	/** Group holds at least one content variable or nested group (decided at parse time). */
	hasContent: boolean;
	/** Group holds only separator variables and whitespace text. */
	onlySeparators: boolean;
};

export type FormatToken =
	| { kind: "text"; value: string }
	| { kind: "var"; name: string }
	| { kind: "fill" }
	| GroupToken;

const TOKEN_REGEX = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/y;

/**
 * Separator vars only style gaps between content; they must not keep a group
 * alive when every real content var is empty (e.g. `($sep$tokens)` drops if
 * tokens is empty).
 */
const NON_CONTENT_VARS = new Set(["sep", "separator"]);

const PARSE_CACHE_LIMIT = 8;
const parseCache = new Map<string, FormatToken[]>();

/**
 * Tokenize a format string into text/var/fill/group tokens. Results are cached
 * per format string, so calling this every frame is O(1) after the first parse.
 *
 * `$name` and `${name}` both produce a variable token. A variable named
 * `fill` becomes a fill token instead. Parentheses form conditional groups
 * that drop entirely when all nested vars are empty.
 */
export function parseFooterFormat(format: string): FormatToken[] {
	if (!format) return [];
	const cached = parseCache.get(format);
	if (cached) return cached;
	const tokens = parseTokenSlice(format, 0, true).tokens;
	if (parseCache.size >= PARSE_CACHE_LIMIT) {
		const oldest = parseCache.keys().next().value;
		if (oldest !== undefined) parseCache.delete(oldest);
	}
	parseCache.set(format, tokens);
	return tokens;
}

function makeGroup(tokens: FormatToken[]): GroupToken {
	let hasContent = false;
	let sawSeparator = false;
	let onlySeparatorsAndSpace = true;
	for (const child of tokens) {
		if (child.kind === "group") {
			hasContent = true;
			onlySeparatorsAndSpace = false;
		} else if (child.kind === "var") {
			if (NON_CONTENT_VARS.has(child.name)) sawSeparator = true;
			else {
				hasContent = true;
				onlySeparatorsAndSpace = false;
			}
		} else if (child.kind === "text" && child.value.trim() !== "") {
			onlySeparatorsAndSpace = false;
		}
	}
	return {
		kind: "group",
		tokens,
		hasContent,
		onlySeparators: sawSeparator && onlySeparatorsAndSpace,
	};
}

function parseTokenSlice(
	format: string,
	start: number,
	topLevel = false,
): { tokens: FormatToken[]; nextIndex: number } {
	const tokens: FormatToken[] = [];
	const end = format.length;
	let index = start;
	let textStart = start;

	const flushText = (until: number) => {
		if (until > textStart) {
			tokens.push({ kind: "text", value: format.slice(textStart, until) });
		}
	};

	while (index < end) {
		const ch = format[index];

		if (ch === "(") {
			flushText(index);
			const nested = parseTokenSlice(format, index + 1, false);
			tokens.push(makeGroup(nested.tokens));
			index = nested.nextIndex;
			textStart = index;
			continue;
		}

		if (ch === ")") {
			// Nested groups close on `)`. Unmatched top-level `)` is literal text so
			// trailing tokens like `$cwd) $tokens` are not discarded.
			if (topLevel) {
				index += 1;
				continue;
			}
			flushText(index);
			return { tokens, nextIndex: index + 1 };
		}

		if (ch === "$") {
			TOKEN_REGEX.lastIndex = index;
			const match = TOKEN_REGEX.exec(format);
			if (match) {
				flushText(index);
				const name = match[1] ?? match[2] ?? "";
				tokens.push(name === "fill" ? { kind: "fill" } : { kind: "var", name });
				index += match[0].length;
				textStart = index;
				continue;
			}
		}

		index += 1;
	}

	flushText(end);
	return { tokens, nextIndex: end };
}

/**
 * Render tokens into `{ left, middle, right }` based on `$fill` markers.
 *
 * - No fill: everything → `left`; `middle` and `right` are `""`.
 * - One fill: tokens before → `left`, tokens after → `right`; `middle` is `""`.
 * - Two fills: before the first → `left`, between the two → `middle`
 *   (centered by the caller via the existing middle-zone logic), after the
 *   second → `right`.
 * - Additional fills beyond the first two are ignored.
 * - `$fill` inside a group is ignored (renders empty).
 *
 * Text tokens contribute their `value` verbatim (unstyled/plain); var tokens
 * contribute `renderVariable(name)` (already styled by caller). No automatic
 * spaces are inserted — the user controls all spacing. Every variable is
 * rendered at most once per call.
 */
export function renderFormatSplit(
	tokens: FormatToken[],
	renderVariable: (name: string) => string,
): { left: string; middle: string; right: string } {
	const fills: number[] = [];
	for (let index = 0; index < tokens.length && fills.length < 2; index++) {
		if (tokens[index]?.kind === "fill") fills.push(index);
	}
	const [first, second] = fills;
	const slice = (start: number, end: number) =>
		renderTokens(tokens, start, end, renderVariable).text;
	if (first === undefined) return { left: slice(0, tokens.length), middle: "", right: "" };
	if (second === undefined) {
		return { left: slice(0, first), middle: "", right: slice(first + 1, tokens.length) };
	}
	return {
		left: slice(0, first),
		middle: slice(first + 1, second),
		right: slice(second + 1, tokens.length),
	};
}

/**
 * Single pass: returns the rendered text plus whether any content variable or
 * nested group in the range produced content (drives group visibility).
 */
function renderTokens(
	tokens: readonly FormatToken[],
	start: number,
	end: number,
	renderVariable: (name: string) => string,
): { text: string; hasVisibleContent: boolean } {
	let text = "";
	let hasVisibleContent = false;
	for (let i = start; i < end; i++) {
		const token = tokens[i];
		if (!token || token.kind === "fill") continue;
		if (token.kind === "text") {
			text += token.value;
			continue;
		}
		if (token.kind === "var") {
			const rendered = renderVariable(token.name);
			text += rendered;
			if (rendered !== "" && !NON_CONTENT_VARS.has(token.name)) hasVisibleContent = true;
			continue;
		}
		const group = renderGroup(token, renderVariable);
		if (group !== undefined) {
			text += group;
			hasVisibleContent = true;
		}
	}
	return { text, hasVisibleContent };
}

/**
 * A group is dropped iff it has content vars/groups and none of them rendered,
 * or it holds nothing but `$sep` and whitespace. Text-only groups always show.
 * Returns `undefined` when the group is dropped.
 */
function renderGroup(
	group: GroupToken,
	renderVariable: (name: string) => string,
): string | undefined {
	if (group.onlySeparators) return undefined;
	const inner = renderTokens(group.tokens, 0, group.tokens.length, renderVariable);
	if (group.hasContent && !inner.hasVisibleContent) return undefined;
	return inner.text;
}

/** One optional SGR sequence (`\x1b[…m`). */
const ANSI_ONE_SRC = "\u001b\\[[0-9;]*m";
const ANSI_ONE_GLOBAL = new RegExp(ANSI_ONE_SRC, "g");

type SeparatorPatterns = { consecutive: RegExp; leading: RegExp; trailing: RegExp };
const separatorPatternCache = new Map<string, SeparatorPatterns | undefined>();

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function separatorPatterns(glyph: string): SeparatorPatterns | undefined {
	if (separatorPatternCache.has(glyph)) return separatorPatternCache.get(glyph);
	// Always treat the classic pipe as a separator too (custom format text often uses it).
	const glyphs = [...new Set(["|", glyph.trim()].filter(Boolean))].map(escapeRegExp);
	// One separator unit: plain or with a single ANSI wrapper on either side of the
	// spaced glyph (matches `renderStyle(..., " › ")` output).
	const unit = `(?:${ANSI_ONE_SRC})?\\s+(?:${glyphs.join("|")})\\s+(?:${ANSI_ONE_SRC})?`;
	const patterns = {
		consecutive: new RegExp(`(${unit})(?:${unit})+`, "g"),
		leading: new RegExp(`^(?:${unit})+`),
		trailing: new RegExp(`(?:${unit})+$`),
	};
	separatorPatternCache.set(glyph, patterns);
	return patterns;
}

/**
 * Tidy a rendered format left/middle/right slice:
 * - collapse repeated separators (plain or simple ANSI-wrapped) into one
 * - strip leading/trailing separators
 * - strip leading/trailing whitespace
 * - drop slices that are only ANSI / whitespace after cleanup
 *
 * `separatorGlyph` is the active `$sep` glyph (e.g. `›`); `|` is always recognized.
 */
export function stripOrphanSeparators(rendered: string, separatorGlyph = "|"): string {
	if (!rendered) return rendered;
	let result = rendered;
	const patterns = separatorPatterns(separatorGlyph);
	if (patterns) {
		// Collapse consecutive separator units, keeping the first (preserves themed color).
		result = result
			.replace(patterns.consecutive, "$1")
			.replace(patterns.leading, "")
			.replace(patterns.trailing, "");
	}
	// Strip leading / trailing plain whitespace left by empty groups.
	result = result.trim();
	// Pure ANSI (or empty) leftovers are not useful content.
	if (result.replace(ANSI_ONE_GLOBAL, "").trim() === "") return "";
	return result;
}
