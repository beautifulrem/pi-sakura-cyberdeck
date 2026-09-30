import { fgAnsi, getColorMode, paintFg } from "../shared/color";

export type RGB = readonly [number, number, number];

export const SAKURA_MACARON_GRADIENT = "sakura-macaron-gradient";
const SAKURA_MACARON_STOPS: readonly RGB[] = [
	[242, 167, 198], // sakura pink  #F2A7C6
	[252, 201, 185], // sakura-iro   #FCC9B9
	[239, 195, 230], // petal        #EFC3E6
	[199, 184, 245], // lavender     #C7B8F5
	[159, 211, 242], // sky macaron  #9FD3F2
];

const RESET = "\x1b[0m";
const GRADIENT_CACHE_LIMIT = 256;
/** LRU of static (phase 0) gradients; animated frames are never cached. */
const gradientCache = new Map<string, string>();
let gradientCacheMode = getColorMode();

/** Soft period for footer shimmer / pulse (ms). */
const FOOTER_PULSE_PERIOD_MS = 1800;

export function mix(from: RGB, to: RGB, amount: number): RGB {
	const t = Math.max(0, Math.min(1, amount));
	return [
		Math.round(from[0] + (to[0] - from[0]) * t),
		Math.round(from[1] + (to[1] - from[1]) * t),
		Math.round(from[2] + (to[2] - from[2]) * t),
	];
}

/** Continuous 0..1 phase from wall clock. */
export function pulsePhase(now = Date.now(), periodMs = FOOTER_PULSE_PERIOD_MS): number {
	const p = periodMs > 0 ? periodMs : FOOTER_PULSE_PERIOD_MS;
	return (((now % p) + p) % p) / p;
}

function sampleStops(stops: readonly RGB[], position: number, phase = 0): RGB {
	// Keep phase shimmer as a true 0..1 wrap; bare position=1 must hit the last stop.
	const clamped = Math.max(0, Math.min(1, position));
	const normalized = phase === 0 ? clamped : (((clamped + phase) % 1) + 1) % 1;
	const scaled = normalized * (stops.length - 1);
	const index = Math.min(stops.length - 2, Math.floor(scaled));
	const from = stops[index] ?? stops[0] ?? [242, 167, 198];
	const to = stops[index + 1] ?? from;
	return mix(from, to, scaled - index);
}

function sampleSakuraGradient(position: number, phase = 0): RGB {
	return sampleStops(SAKURA_MACARON_STOPS, position, phase);
}

const graphemeSegmenter =
	typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: undefined;

/** Split into user-perceived characters; ASCII fast path avoids the segmenter. */
export function splitGraphemes(text: string): string[] {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII range check
	if (/^[\x00-\x7f]*$/.test(text) || !graphemeSegmenter) return [...text];
	return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

function cacheGet(key: string): string | undefined {
	const mode = getColorMode();
	if (mode !== gradientCacheMode) {
		gradientCache.clear();
		gradientCacheMode = mode;
		return undefined;
	}
	const cached = gradientCache.get(key);
	if (cached !== undefined) {
		// Refresh recency (Map preserves insertion order).
		gradientCache.delete(key);
		gradientCache.set(key, cached);
	}
	return cached;
}

function cacheSet(key: string, value: string): void {
	if (gradientCache.size >= GRADIENT_CACHE_LIMIT) {
		const oldest = gradientCache.keys().next().value;
		if (oldest !== undefined) gradientCache.delete(oldest);
	}
	gradientCache.set(key, value);
}

/** Test helper: current number of cached gradient strings. */
export function gradientCacheSize(): number {
	return gradientCache.size;
}

function paintPositions(text: string, colorAt: (position: number) => RGB): string {
	if (getColorMode() === "none") return text;
	const chars = splitGraphemes(text);
	if (chars.length === 0) return text;
	const span = Math.max(1, chars.length - 1);
	let rendered = "";
	for (let index = 0; index < chars.length; index++) {
		const char = chars[index] ?? "";
		rendered += char === " " ? char : `${fgAnsi(colorAt(index / span))}${char}`;
	}
	return `${rendered}${RESET}`;
}

/** Render Sakura → sky gradient. Optional phase shifts the stops for shimmer. */
export function renderSakuraGradient(text: string, phase = 0): string {
	if (!text) return text;
	if (phase !== 0) return paintPositions(text, (pos) => sampleSakuraGradient(pos, phase));
	const cached = cacheGet(text);
	if (cached !== undefined) return cached;
	const rendered = paintPositions(text, (pos) => sampleSakuraGradient(pos));
	cacheSet(text, rendered);
	return rendered;
}

/**
 * Box-frame gradient: sakura at BOTH ends, macaron spectrum through the middle.
 * Avoids the linear L→R look where the right corner jumps to sky cyan.
 */
export function renderSakuraFrameGradient(text: string): string {
	if (!text) return text;
	const cacheKey = `\0frame\0${text}`;
	const cached = cacheGet(cacheKey);
	if (cached !== undefined) return cached;
	// 0 → 1 → 0 so left/right corners share sakura pink.
	const rendered = paintPositions(text, (pos) =>
		sampleSakuraGradient(pos <= 0.5 ? pos * 2 : (1 - pos) * 2),
	);
	cacheSet(cacheKey, rendered);
	return rendered;
}

/** Context fill palettes — stay macaron, shift with severity. */
export type GaugeTier = "normal" | "warning" | "error";

const WARNING_FILL: RGB = [243, 217, 139]; // solid butter — no pink end that looks "healthy"
const ERROR_FILL: RGB = [255, 143, 163]; // solid coral
const GAUGE_TRACK: RGB = [180, 168, 184]; // soft lilac track, readable on light + dark

/**
 * Macaron gauge body (no frame). Fill walks the sakura palette for the normal
 * tier and uses a solid warning/error color otherwise; soft hotspot with phase.
 */
export function renderMacaronGauge(
	percent: number,
	width = 10,
	options: { phase?: number; tier?: GaugeTier } = {},
): string {
	const cells = Math.max(1, Math.floor(width));
	const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
	const filled = Math.round((clamped / 100) * cells);
	const phase = options.phase ?? 0;
	const tier = options.tier ?? "normal";
	let body = "";
	for (let i = 0; i < cells; i++) {
		if (i >= filled) {
			body += paintFg(GAUGE_TRACK, "░");
			continue;
		}
		const base =
			tier === "warning"
				? WARNING_FILL
				: tier === "error"
					? ERROR_FILL
					: sampleSakuraGradient(cells <= 1 ? 0 : i / Math.max(1, filled - 1), phase * 0.2);
		const wave = 0.5 + 0.5 * Math.sin((i / cells + phase) * Math.PI * 2);
		body += paintFg(mix(base, [255, 252, 250], wave * 0.15), "█");
	}
	return body;
}
