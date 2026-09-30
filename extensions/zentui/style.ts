import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { fgAnsi, bgAnsi, getColorMode, hexToRgb, paintFg } from "../shared/color";
import type { ColorSource, ColorSpec } from "./config";

type ThemeLike = {
	fg(color: string, text: string): string;
	bold?: (text: string) => string;
	italic?: (text: string) => string;
	underline?: (text: string) => string;
};

export type { ThemeLike };

const EDITOR_ACCENT_STYLE = "blue";
export const EDITOR_BORDER_STYLE = "bright-black";

export type SourceStyleFallback = {
	theme: ColorSpec;
	terminal: ColorSpec;
};

export const EDITOR_ACCENT_FALLBACK: SourceStyleFallback = {
	theme: "accent",
	terminal: EDITOR_ACCENT_STYLE,
};

export const EDITOR_BORDER_FALLBACK: SourceStyleFallback = {
	theme: "borderMuted",
	terminal: EDITOR_BORDER_STYLE,
};

function isHexColor(value: string): boolean {
	return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/** SGR parameter body (no ESC[ / m) for a hex color in the active color mode. */
function hexToSgrParams(hex: string, isBackground = false): string {
	const rgb = hexToRgb(hex);
	const sequence = isBackground ? bgAnsi(rgb) : fgAnsi(rgb);
	return sequence ? sequence.slice(2, -1) : "";
}

const terminalColorCodes = new Map([
	["black", 30],
	["red", 31],
	["green", 32],
	["yellow", 33],
	["blue", 34],
	["purple", 35],
	["cyan", 36],
	["white", 37],
	["bright-black", 90],
	["bright-red", 91],
	["bright-green", 92],
	["bright-yellow", 93],
	["bright-blue", 94],
	["bright-purple", 95],
	["bright-cyan", 96],
	["bright-white", 97],
]);

const terminalStyleModifiers = new Map([
	["bold", 1],
	["dim", 2],
	["dimmed", 2],
	["italic", 3],
	["underline", 4],
]);

const themeColorNameMap = new Map([
	["red", "error"],
	["bright-red", "error"],
	["green", "success"],
	["bright-green", "success"],
	["yellow", "warning"],
	["bright-yellow", "warning"],
	["blue", "syntaxFunction"],
	["bright-blue", "syntaxFunction"],
	["cyan", "syntaxFunction"],
	["bright-cyan", "syntaxFunction"],
	["purple", "syntaxKeyword"],
	["bright-purple", "syntaxKeyword"],
	["black", "muted"],
	["bright-black", "muted"],
	["white", "text"],
	["bright-white", "text"],
]);

const themeStyleModifiers = new Set(["bold", "italic", "underline"]);

const themeColorTokens = new Set<ThemeColor>([
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
	"bashMode",
]);

const ANSI_256_PATTERN = /^(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;

function isTerminalColorName(color: string): boolean {
	const normalized = color.toLowerCase();
	return (
		terminalColorCodes.has(normalized) || ANSI_256_PATTERN.test(normalized) || isHexColor(normalized)
	);
}

/**
 * SGR parameters for a terminal color. Returns `undefined` for unknown names and
 * `""` when colors are disabled (NO_COLOR) so callers can still treat the token as valid.
 */
function terminalColorToAnsi(color: string, isBackground = false): string | undefined {
	const normalized = color.toLowerCase();
	if (!isTerminalColorName(normalized)) return undefined;
	if (getColorMode() === "none") return "";
	const colorCode = terminalColorCodes.get(normalized);
	if (colorCode !== undefined) return `${isBackground ? colorCode + 10 : colorCode}`;
	if (ANSI_256_PATTERN.test(normalized)) return `${isBackground ? 48 : 38};5;${normalized}`;
	return hexToSgrParams(normalized, isBackground);
}

function isExplicitTerminalColorToken(token: string): boolean {
	const normalized = token.toLowerCase();
	if (normalized.startsWith("fg:") || normalized.startsWith("bg:")) return true;
	if (isHexColor(normalized)) return true;
	return ANSI_256_PATTERN.test(normalized);
}

/** Token that `renderTerminalStyle` understands (modifier, named/256/hex color, fg:/bg:). */
function isTerminalStyleToken(token: string): boolean {
	const normalized = token.toLowerCase();
	if (terminalStyleModifiers.has(normalized)) return true;
	if (isTerminalColorName(normalized)) return true;
	if (normalized.startsWith("fg:") || normalized.startsWith("bg:")) {
		return isTerminalColorName(normalized.slice(3));
	}
	return false;
}

function isSupportedStyleToken(token: string): boolean {
	return isTerminalStyleToken(token) || themeColorTokens.has(token as ThemeColor);
}

export function isSupportedColorSpec(style: ColorSpec): boolean {
	const trimmed = style.trim();
	if (trimmed === "") return true;
	return trimmed.split(/\s+/).every(isSupportedStyleToken);
}

function applyThemeModifiers(theme: ThemeLike, styleTokens: string[], text: string): string {
	let rendered = text;
	for (const token of styleTokens) {
		const normalized = token.toLowerCase();
		if (normalized === "bold") rendered = theme.bold?.(rendered) ?? rendered;
		if (normalized === "italic") rendered = theme.italic?.(rendered) ?? rendered;
		if (normalized === "underline") rendered = theme.underline?.(rendered) ?? rendered;
	}
	return rendered;
}

export function safeThemeFg(theme: ThemeLike, color: string, text: string): string {
	try {
		return theme.fg(color, text);
	} catch {
		return text;
	}
}

function mapThemeColor(styleTokens: string[]): string | undefined {
	let fallback: string | undefined;
	for (const token of styleTokens) {
		const normalized = token.toLowerCase();
		if (themeStyleModifiers.has(normalized)) continue;
		if (normalized === "dim" || normalized === "dimmed") {
			fallback = "muted";
			continue;
		}

		const mapped = themeColorNameMap.get(normalized);
		if (mapped) return mapped;
		return token;
	}
	return fallback;
}

/**
 * Colorize text using a theme color token or hex color.
 * Non-hex values are passed directly to `theme.fg()`; invalid tokens fall back
 * to unstyled text so a config typo does not break rendering.
 */
export function colorize(theme: ThemeLike, color: ColorSpec, text: string): string {
	if (isHexColor(color)) return paintFg(hexToRgb(color), text);
	return safeThemeFg(theme, color, text);
}

/**
 * Render text with Starship-style terminal styling strings (e.g. "bold red", "fg:202",
 * "bg:blue", "underline bg:#bf5700").
 */
function renderTerminalStyle(style: string, text: string): string {
	const codes: string[] = [];
	for (const token of style.trim().split(/\s+/)) {
		if (!token) continue;

		const normalized = token.toLowerCase();
		const modifier = terminalStyleModifiers.get(normalized);
		if (modifier !== undefined) {
			codes.push(`${modifier}`);
			continue;
		}

		const isForeground = normalized.startsWith("fg:");
		const isBackground = normalized.startsWith("bg:");
		const colorName = isForeground || isBackground ? normalized.slice(3) : normalized;
		const color = terminalColorToAnsi(colorName, isBackground);
		if (color) codes.push(color);
	}

	return codes.length ? `\x1b[${codes.join(";")}m${text}\x1b[0m` : text;
}

/**
 * Apply Starship-style terminal styling, falling back to Pi theme tokens for
 * values such as "accent" or "syntaxKeyword". Mixed specs ("bold accent") keep
 * both the terminal modifiers and the theme color.
 */
export function renderStyle(theme: ThemeLike, style: ColorSpec, text: string): string {
	const tokens = style.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return text;
	const themeTokens = tokens.filter((token) => !isTerminalStyleToken(token));
	if (themeTokens.length === 0) return renderTerminalStyle(style, text);
	const colored = colorize(theme, themeTokens[0] ?? "", text);
	const terminalPart = tokens.filter(isTerminalStyleToken).join(" ");
	return terminalPart ? renderTerminalStyle(terminalPart, colored) : colored;
}

function renderThemeStyle(theme: ThemeLike, style: ColorSpec, text: string): string {
	const trimmed = style.trim();
	if (trimmed === "") return text;

	const tokens = trimmed.split(/\s+/).filter(Boolean);
	if (tokens.some(isExplicitTerminalColorToken)) return renderTerminalStyle(style, text);

	const color = mapThemeColor(tokens) ?? "text";
	return safeThemeFg(theme, color, applyThemeModifiers(theme, tokens, text));
}

export function renderStyleForSource(
	theme: ThemeLike,
	source: ColorSource,
	style: ColorSpec,
	text: string,
): string {
	return source === "terminal"
		? renderStyle(theme, style, text)
		: renderThemeStyle(theme, style, text);
}

export function renderStyleForSourceOrFallback(
	theme: ThemeLike,
	source: ColorSource,
	style: ColorSpec | undefined,
	fallback: ColorSpec | SourceStyleFallback,
	text: string,
): string {
	const fallbackStyle = typeof fallback === "string" ? fallback : fallback[source];
	return renderStyleForSource(theme, source, style ?? fallbackStyle, text);
}

export function renderChromeBorder(
	theme: ThemeLike,
	source: ColorSource,
	terminalFallbackStyle: ColorSpec,
	text: string,
): string {
	return renderStyleForSourceOrFallback(
		theme,
		source,
		undefined,
		{ theme: "borderMuted", terminal: terminalFallbackStyle },
		text,
	);
}
