import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type RGB = readonly [number, number, number];

export const SAKURA_MACARON_GRADIENT = "sakura-macaron-gradient";
export const SAKURA_MACARON_STOPS: readonly RGB[] = [
	[242, 167, 198], // sakura pink  #F2A7C6
	[252, 201, 185], // sakura-iro   #FCC9B9
	[239, 195, 230], // petal        #EFC3E6
	[199, 184, 245], // lavender     #C7B8F5
	[159, 211, 242], // sky macaron  #9FD3F2
];

const RESET = "\x1b[0m";
const GRADIENT_CACHE_LIMIT = 256;
const gradientCache = new Map<string, string>();

/** Soft period for footer shimmer / pulse (ms). */
export const FOOTER_PULSE_PERIOD_MS = 1800;

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
	return ((now % p) + p) % p / p;
}

export function sampleSakuraGradient(position: number, phase = 0): RGB {
	const stops = SAKURA_MACARON_STOPS;
	// Keep phase shimmer as a true 0..1 wrap; bare position=1 must hit the last stop
	// (do not use `1 % 1 === 0`, which snapped the right edge back to sakura).
	let normalized = Math.max(0, Math.min(1, position));
	if (phase !== 0) {
		normalized = ((normalized + phase) % 1 + 1) % 1;
	}
	const scaled = normalized * (stops.length - 1);
	const index = Math.min(stops.length - 2, Math.floor(scaled));
	const from = stops[index] ?? SAKURA_MACARON_STOPS[0] ?? [242, 167, 198];
	const to = stops[index + 1] ?? from;
	return mix(from, to, scaled - index);
}

export function rgbForeground(color: RGB, text: string, bold = false): string {
	// Prefer fg/bold resets over full SGR reset so surrounding theme colors can resume.
	const open = bold ? "\x1b[1m" : "";
	const close = bold ? "\x1b[22m\x1b[39m" : "\x1b[39m";
	return `${open}\x1b[38;2;${color[0]};${color[1]};${color[2]}m${text}${close}`;
}

function foreground(color: RGB, text: string): string {
	return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m${text}`;
}

/** Render Sakura → sky gradient. Optional phase shifts the stops for shimmer. */
export function renderSakuraGradient(text: string, phase = 0): string {
	const cacheKey = phase === 0 ? text : `${phase.toFixed(3)}|${text}`;
	const cached = gradientCache.get(cacheKey);
	if (cached !== undefined) return cached;
	const chars = [...text];
	if (chars.length === 0) return text;
	const span = Math.max(1, chars.length - 1);
	const rendered = `${chars
		.map((char, index) =>
			char === " " ? char : foreground(sampleSakuraGradient(index / span, phase), char),
		)
		.join("")}${RESET}`;
	if (gradientCache.size >= GRADIENT_CACHE_LIMIT) {
		gradientCache.delete(gradientCache.keys().next().value ?? "");
	}
	gradientCache.set(cacheKey, rendered);
	return rendered;
}

/**
 * Box-frame gradient: sakura at BOTH ends, macaron spectrum through the middle.
 * Avoids the linear L→R look where the right corner jumps to sky cyan.
 */
export function renderSakuraFrameGradient(text: string): string {
	const cacheKey = `frame|${text}`;
	const cached = gradientCache.get(cacheKey);
	if (cached !== undefined) return cached;
	const chars = [...text];
	if (chars.length === 0) return text;
	const span = Math.max(1, chars.length - 1);
	const rendered = `${chars
		.map((char, index) => {
			if (char === " ") return char;
			const pos = index / span;
			// 0 → 1 → 0 so left/right corners share sakura pink.
			const mirrored = pos <= 0.5 ? pos * 2 : (1 - pos) * 2;
			return foreground(sampleSakuraGradient(mirrored), char);
		})
		.join("")}${RESET}`;
	if (gradientCache.size >= GRADIENT_CACHE_LIMIT) {
		gradientCache.delete(gradientCache.keys().next().value ?? "");
	}
	gradientCache.set(cacheKey, rendered);
	return rendered;
}

/** Solid sakura stop — vertical rails / corners that must match the frame ends. */
export function renderSakuraSolid(text: string, position = 0): string {
	return rgbForeground(sampleSakuraGradient(position), text);
}


/** Context / quota fill palettes — stay macaron, shift with severity. */
export type GaugeTier = "normal" | "warning" | "error";

const GAUGE_STOPS: Record<GaugeTier, readonly RGB[]> = {
	// healthy: sakura → peach → lavender → sky
	normal: SAKURA_MACARON_STOPS,
	// warning: stay warm (peach → butter). Do NOT end on sakura or it looks "healthy".
	warning: [
		[252, 201, 185], // peach
		[248, 210, 160],
		[243, 217, 139], // butter
		[230, 190, 100], // deeper butter
	],
	// error: rose → coral only (no sakura pink start that confuses with normal)
	error: [
		[255, 176, 196], // soft rose
		[255, 160, 180],
		[255, 143, 163], // coral
		[232, 120, 150], // deeper rose
	],
};

function sampleStops(stops: readonly RGB[], position: number, phase = 0): RGB {
	const n =
		phase === 0
			? Math.max(0, Math.min(1, position))
			: (((Math.max(0, Math.min(1, position)) + phase) % 1) + 1) % 1;
	const scaled = n * (stops.length - 1);
	const index = Math.min(stops.length - 2, Math.floor(scaled));
	const from = stops[index] ?? stops[0] ?? [242, 167, 198];
	const to = stops[index + 1] ?? from;
	return mix(from, to, scaled - index);
}

/**
 * Truecolor macaron gauge. Fill walks a tier palette; soft hotspot with phase.
 * Empty track is soft lilac (readable on light + dark).
 */
export function renderMacaronGauge(
	percent: number,
	width = 10,
	options: { ascii?: boolean; phase?: number; frame?: boolean; tier?: GaugeTier } = {},
): string {
	const cells = Math.max(1, Math.floor(width));
	const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
	const filled = Math.round((clamped / 100) * cells);
	const phase = options.phase ?? 0;
	const tier = options.tier ?? "normal";
	const stops = GAUGE_STOPS[tier] ?? GAUGE_STOPS.normal;
	const on = options.ascii ? "#" : "█";
	const off = options.ascii ? "-" : "░";
	const body: string[] = [];
	for (let i = 0; i < cells; i++) {
		if (i < filled) {
			let base: RGB;
			if (tier === "warning") {
				// solid butter — no pink end that looks "healthy" at high fill
				base = [243, 217, 139];
			} else if (tier === "error") {
				base = [255, 143, 163]; // solid coral
			} else {
				const pos = cells <= 1 ? 0 : i / Math.max(1, filled - 1);
				base = sampleStops(stops, pos, phase * 0.2);
			}
			const wave = 0.5 + 0.5 * Math.sin((i / cells + phase) * Math.PI * 2);
			const lit = mix(base, [255, 252, 250], wave * 0.15);
			body.push(rgbForeground(lit, on));
		} else {
			// Soft track — not black-grey hole on light themes
			body.push(`\x1b[38;2;180;168;184m${off}\x1b[39m`);
		}
	}
	const bar = body.join("");
	if (options.frame === false) return bar;
	const edge = sampleStops(stops, phase === 0 ? 0 : phase, 0);
	return `${rgbForeground(edge, "▕")}${bar}${rgbForeground(edge, "▏")}`;
}

/** Full-width hairline that shimmers across the footer. */
export function renderGradientHairline(width: number, phase = 0, glyph = "━"): string {
	if (width <= 0) return "";
	const chars = glyph.repeat(width);
	return renderSakuraGradient(chars, phase);
}

/** Dim / brighten an RGB by mixing toward black or white. */
export function toneRgb(color: RGB, amount: number): RGB {
	if (amount >= 0) return mix(color, [255, 255, 255], Math.min(1, amount));
	return mix(color, [20, 16, 28], Math.min(1, -amount));
}

/**
 * Side rails + body. Always keep left/right chrome fully visible.
 * Never append "..." — outer truncate defaults to "..." and looks like junk on every row.
 */
export function renderBoxedLine(
	line: string,
	width: number,
	leftRail: string,
	rightRail: string,
): string {
	if (width <= 0) return "";
	const leftWidth = visibleWidth(leftRail);
	const rightWidth = visibleWidth(rightRail);
	// If rails alone exceed width, prefer left rail only.
	if (leftWidth + rightWidth > width) {
		return truncateToWidth(leftRail, width, "");
	}
	const innerWidth = Math.max(0, width - leftWidth - rightWidth);
	// Never use default truncate ellipsis ("...") — empty string only.
	// Also drop only a pure trailing ... marker from prior truncators (not mid-line).
	let plainish = line;
	if (/(?:…|\.\.\.)\s*$/u.test(plainish) && visibleWidth(plainish) >= innerWidth) {
		plainish = plainish.replace(/(?:…|\.\.\.)\s*$/u, "");
	}
	let content = truncateToWidth(plainish, innerWidth, "");
	// Hard-fit: SGR / width drift can leave content 1 cell over.
	let guard = 0;
	while (visibleWidth(content) > innerWidth && content.length > 0 && guard++ < 8) {
		content = truncateToWidth(content, Math.max(0, visibleWidth(content) - 1), "");
	}
	const pad = Math.max(0, innerWidth - visibleWidth(content));
	const out = `${leftRail}${content}${" ".repeat(pad)}${rightRail}`;
	// Final clamp without ellipsis if still over (should be rare).
	if (visibleWidth(out) > width) {
		return truncateToWidth(out, width, "");
	}
	return out;
}
