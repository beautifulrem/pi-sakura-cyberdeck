import type { MarkdownTransformContext, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { sanitizeDisplayText } from "./extension-status";
import { type RGB, fgAnsi, getColorMode } from "../shared/color";
import { renderSakuraGradient, renderSakuraGradientOpen } from "./gradient";

/**
 * Compact "✦ Thought trail" digest for visible thinking blocks, via Pi's public
 * markdown transformer (`messageTypes: ["assistant-thinking"]`).
 *
 * Display-only: Pi renders the transformed markdown for the screen, while the session
 * and model context keep the full thinking text. No prototype patches, no rewriting of
 * tool output. Hidden thinking is unaffected (Pi renders it as a plain label, not markdown).
 *
 * We wrap step text ourselves (instead of letting Markdown wrap it) so every continuation
 * row keeps its `│`/` ` rail and the tree never breaks at a soft wrap.
 *
 * Some models (notably Gemini behind OpenAI-compatible endpoints) write their reasoning into
 * the answer text as `<thinking>…</thinking>` instead of a structured thinking block. Pi then
 * renders the tags literally. For `assistant` text we lift such tagged blocks into the same
 * trail, again display-only.
 */

const DEFAULT_WIDTH = 100;
const MAX_BODY_LINES = 16;
export const THOUGHT_TRAIL_GLYPH = "✦";
export const THOUGHT_STEP_GLYPH = "◇";

/** 5 visible columns: `├─ ◇ ` / `╰─ ◇ ` / `│    ` / `     `. */
const RAIL_WIDTH = 5;
const RAIL_OPEN = `├─ ${THOUGHT_STEP_GLYPH} `;
const RAIL_LAST = `╰─ ${THOUGHT_STEP_GLYPH} `;
const RAIL_CONT = "│    ";
const RAIL_CONT_LAST = "     ";

/** GFM hard line break: two trailing spaces keep the tree on separate rows. */
const HARD_BREAK = "  \n";
/** Body tone — same soft lilac Pi uses for `thinkingText`, so step text reads like thinking. */
const BODY_TINT: RGB = [216, 202, 220];
const RESET = "\x1b[0m";

/**
 * Gradient rail + tinted body, closed with a reset so the row carries the same
 * well-formed SGR span as the gradient header (some renderers only honour a
 * style that is explicitly terminated).
 */
function paintRail(rail: string, text: string): string {
	const reset = getColorMode() === "none" ? "" : RESET;
	return `${renderSakuraGradientOpen(rail)}${fgAnsi(BODY_TINT)}${text}${reset}`;
}

function collapse(text: string): string {
	return sanitizeDisplayText(text.replace(/\s+/g, " ")).trim();
}

/** Keep Markdown/math/link parsing from consuming a prewrapped row or its rails. */
function literalRow(row: string): string {
	const runs = row.match(/`+/g) ?? [];
	const fence = "`".repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
	return `${fence} ${row} ${fence}`;
}

/** First non-empty line of each blank-line-separated paragraph = one "step". */
export function thinkingSteps(markdown: string): string[] {
	return markdown
		.split(/\n\s*\n+/)
		.map((block) => block.split("\n").find((line) => line.trim()) ?? "")
		.map(collapse)
		.filter((line) => line.length > 0);
}

/** Build the compact trail markdown, or `undefined` when there is nothing to show. */
export function buildThinkingTrail(markdown: string, availableWidth = DEFAULT_WIDTH): string | undefined {
	const steps = thinkingSteps(markdown);
	if (steps.length === 0) return undefined;

	const width = Number.isFinite(availableWidth) ? Math.floor(availableWidth) : DEFAULT_WIDTH;
	// A two-cell grapheme must fit beside the rail. Let Pi render normally below that.
	if (width < RAIL_WIDTH + 2) return undefined;
	const contentWidth = width - RAIL_WIDTH;
	const wrapped = steps.map((step) => {
		const lines = wrapTextWithAnsi(step, contentWidth);
		return lines.length > 0 ? lines : [""];
	});
	const totalLines = wrapped.reduce((count, lines) => count + lines.length, 0);
	const complete = totalLines <= MAX_BODY_LINES;

	const label =
		steps.length > 1
			? `${THOUGHT_TRAIL_GLYPH} Thought trail · ${steps.length} steps`
			: `${THOUGHT_TRAIL_GLYPH} Thought trail`;
	const lines = [renderSakuraGradient(sanitizeDisplayText(truncateToWidth(label, width)))];

	let emitted = 0;
	for (let i = 0; i < wrapped.length && emitted < MAX_BODY_LINES; i++) {
		const stepLines = wrapped[i]!;
		const isLastStep = i === wrapped.length - 1 && complete;
		for (let j = 0; j < stepLines.length && emitted < MAX_BODY_LINES; j++) {
			const prefix = j > 0 ? (isLastStep ? RAIL_CONT_LAST : RAIL_CONT) : isLastStep ? RAIL_LAST : RAIL_OPEN;
			lines.push(literalRow(paintRail(prefix, stepLines[j]!)));
			emitted += 1;
		}
	}
	if (!complete) lines.push(literalRow(paintRail("╰─ ", truncateToWidth(`… +${totalLines - emitted} more`, width - 3))));

	return lines.join(HARD_BREAK);
}

export type TaggedSegment =
	| { kind: "text"; text: string }
	| { kind: "thinking"; body: string; raw: string; closed: boolean };

/** Tag names models use for inline reasoning. */
const THINKING_TAG = /^[ \t]{0,3}<(thinking|think|thought)>/i;
const FENCE_OPEN = /^[ ]{0,3}(`{3,}|~{3,})/;

function closesFence(line: string, fence: string): boolean {
	const match = /^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
	return !!match && match[1]![0] === fence[0] && match[1]!.length >= fence.length;
}

/**
 * Split assistant text into plain text and `<thinking>` blocks. An opening tag only counts at
 * the start of a line (up to three spaces of indent) outside fenced code, so prose or code that
 * merely mentions the tag is left alone. Returns `undefined` when there is no tagged block.
 */
export function splitTaggedThinking(markdown: string): TaggedSegment[] | undefined {
	const segments: TaggedSegment[] = [];
	let textStart = 0;
	let pos = 0;
	let fence: string | undefined;
	let found = false;
	while (pos < markdown.length) {
		const newline = markdown.indexOf("\n", pos);
		const end = newline === -1 ? markdown.length : newline;
		const line = markdown.slice(pos, end);
		if (fence) {
			if (closesFence(line, fence)) fence = undefined;
		} else {
			const fenceOpen = FENCE_OPEN.exec(line);
			const open = fenceOpen ? null : THINKING_TAG.exec(line);
			if (fenceOpen) {
				fence = fenceOpen[1];
			} else if (open) {
				found = true;
				if (pos > textStart) segments.push({ kind: "text", text: markdown.slice(textStart, pos) });
				const bodyStart = pos + open[0].length;
				const close = new RegExp(`</${open[1]}\\s*>`, "i").exec(markdown.slice(bodyStart));
				if (!close) {
					segments.push({
						kind: "thinking",
						body: markdown.slice(bodyStart),
						raw: markdown.slice(pos),
						closed: false,
					});
					return segments;
				}
				const closeEnd = bodyStart + close.index + close[0].length;
				segments.push({
					kind: "thinking",
					body: markdown.slice(bodyStart, bodyStart + close.index),
					raw: markdown.slice(pos, closeEnd),
					closed: true,
				});
				// Continue on whatever follows the closing tag, as if it began a line.
				pos = textStart = closeEnd;
				continue;
			}
		}
		if (newline === -1) break;
		pos = newline + 1;
	}
	if (!found) return undefined;
	if (textStart < markdown.length) segments.push({ kind: "text", text: markdown.slice(textStart) });
	return segments;
}

/** Drop the blank lines around a text piece, keeping leading indentation (indented code). */
function trimBlankLines(text: string): string {
	return text.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
}

/**
 * Replace `<thinking>` blocks in assistant text with trails. An unclosed block becomes a trail
 * while streaming (the model is still thinking) and stays literal once the message is final.
 */
export function buildTaggedThinkingTrail(
	markdown: string,
	availableWidth = DEFAULT_WIDTH,
	isStreaming = false,
): string | undefined {
	const segments = splitTaggedThinking(markdown);
	if (!segments) return undefined;
	const pieces: string[] = [];
	for (const segment of segments) {
		if (segment.kind === "text") {
			pieces.push(trimBlankLines(segment.text));
			continue;
		}
		if (!segment.closed && !isStreaming) {
			pieces.push(trimBlankLines(segment.raw));
			continue;
		}
		// An empty `<thinking></thinking>` simply disappears.
		if (thinkingSteps(segment.body).length === 0) continue;
		const trail = buildThinkingTrail(segment.body, availableWidth);
		// Too narrow for the rails: let Pi render the original text.
		if (trail === undefined) return undefined;
		pieces.push(trail);
	}
	return pieces.filter((piece) => piece.length > 0).join("\n\n");
}

export function makeThinkingTrailTransformer(isEnabled: () => boolean): MarkdownTransformer {
	return (markdown: string, context: MarkdownTransformContext): string => {
		if (context.messageType !== "assistant-thinking" && context.messageType !== "assistant") return markdown;
		if (!isEnabled()) return markdown;
		try {
			if (context.messageType === "assistant") {
				return buildTaggedThinkingTrail(markdown, context.availableWidth, context.isStreaming) ?? markdown;
			}
			return buildThinkingTrail(markdown, context.availableWidth) ?? markdown;
		} catch {
			// A transformer that throws keeps the partial output; return the original instead.
			return markdown;
		}
	};
}

/** Register the transformer. No-op on hosts without the public hook (Pi < 0.87.1). */
export function registerThinkingTrail(
	pi: {
		registerMarkdownTransformer?: (
			transformer: MarkdownTransformer,
			options?: { messageTypes?: readonly MarkdownTransformContext["messageType"][] },
		) => void;
	},
	isEnabled: () => boolean,
): void {
	if (typeof pi.registerMarkdownTransformer !== "function") return;
	try {
		pi.registerMarkdownTransformer(makeThinkingTrailTransformer(isEnabled), {
			messageTypes: ["assistant-thinking", "assistant"],
		});
	} catch {
		// Older/alternate hosts: leave thinking rendering to Pi.
	}
}
