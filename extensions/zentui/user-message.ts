import { type Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { getColorMode, paintFg, type RGB } from "../shared/color";
import type { PolishedTuiConfig } from "./config";
import { renderSakuraFrameGradient } from "./gradient";
import { installPrototypePatch } from "./prototype-patch-registry";

/**
 * User prompt chrome: gradient hairlines above/below plus a sakura rail on the left.
 *
 * The message body is Pi's own UserMessageComponent render (markdown options, extension
 * markdown transformers, outputPad, OSC 133 prompt markers) at the reduced width, passed through
 * byte-for-byte. Copy-friendly mode drops the rail so copied text has no extra glyphs.
 */

type Cleanup = () => void;

type UserMessageCard = {
	width: number;
	chromeKey: string;
	inner: readonly string[];
	lines: string[];
};

const RAIL_RGB: RGB = [242, 167, 198];
const MIN_WIDTH = 8;

function sameLines(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function railFor(config: PolishedTuiConfig | undefined): { text: string; columns: number } {
	if (!config || config.features?.copyFriendly) return { text: "", columns: 0 };
	const glyph = typeof config.icons?.rail === "string" ? config.icons.rail : "▐";
	// Control characters would corrupt the row; fall back to the default glyph.
	const safe = /[\u0000-\u001f\u007f-\u009f]/.test(glyph) || visibleWidth(glyph) > 2 ? "▐" : glyph;
	const text = `${safe} `;
	return { text, columns: visibleWidth(text) };
}

export function renderUserMessageCard(inner: readonly string[], width: number, rail: string): string[] {
	const border = renderSakuraFrameGradient("─".repeat(width));
	const lines: string[] = [border];
	for (const line of inner) lines.push(rail ? `${rail}${line}` : line);
	lines.push(border);
	return lines;
}

export function installUserMessageStyle(
	_getTheme?: () => Theme | undefined,
	getConfig?: () => PolishedTuiConfig,
): Cleanup {
	const cards = new WeakMap<object, UserMessageCard>();
	return installPrototypePatch(
		UserMessageComponent.prototype,
		"render",
		"user-message-render",
		({ predecessor, receiver, args }) => {
			const width = args[0];
			if (typeof width !== "number" || width < MIN_WIDTH) {
				return Reflect.apply(predecessor, receiver, args);
			}
			const rail = railFor(getConfig?.());
			const inner = Reflect.apply(predecessor, receiver, [width - rail.columns, ...args.slice(1)]);
			if (!Array.isArray(inner) || inner.length === 0) return inner;

			const lines = inner as string[];
			const colorMode = getColorMode();
			const chromeKey = `${rail.text}\0${colorMode}`;
			const cached = cards.get(receiver as object);
			if (
				cached &&
				cached.width === width &&
				cached.chromeKey === chromeKey &&
				sameLines(cached.inner, lines)
			) {
				return cached.lines;
			}
			const card = renderUserMessageCard(lines, width, rail.text ? paintFg(RAIL_RGB, rail.text) : "");
			cards.set(receiver as object, { width, chromeKey, inner: lines, lines: card });
			return card;
		},
	);
}
