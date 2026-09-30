// Shared color output for every extension in this pack.
// Emits 24-bit SGR on truecolor terminals, the nearest xterm-256 index otherwise,
// and nothing at all when NO_COLOR is set. Call `syncColorMode(ctx.ui.theme)` on
// session start so Pi's own detection (including `terminal.trueColor`) wins.

export type RGB = readonly [number, number, number];
export type ColorMode = "truecolor" | "256color" | "none";

const TRUECOLOR_TERM_PROGRAMS = new Set([
	"iTerm.app",
	"WezTerm",
	"ghostty",
	"vscode",
	"Hyper",
	"Tabby",
	"rio",
	"WarpTerminal",
]);

export function detectColorMode(env: NodeJS.ProcessEnv = process.env): ColorMode {
	if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return "none";
	const colorTerm = env.COLORTERM?.toLowerCase() ?? "";
	if (colorTerm === "truecolor" || colorTerm === "24bit") return "truecolor";
	const term = env.TERM?.toLowerCase() ?? "";
	if (term.includes("truecolor") || term.includes("24bit") || term.endsWith("-direct")) return "truecolor";
	if (env.WT_SESSION || env.KITTY_WINDOW_ID || env.ALACRITTY_WINDOW_ID || env.GHOSTTY_RESOURCES_DIR) {
		return "truecolor";
	}
	if (env.TERM_PROGRAM && TRUECOLOR_TERM_PROGRAMS.has(env.TERM_PROGRAM)) return "truecolor";
	return "256color";
}

let mode: ColorMode = detectColorMode();

export function getColorMode(): ColorMode {
	return mode;
}

export function setColorMode(next: ColorMode): void {
	mode = next;
}

/** Adopt Pi's detected color mode when the theme exposes it; NO_COLOR always wins. */
export function syncColorMode(theme?: { getColorMode?: () => string } | null): ColorMode {
	const detected = detectColorMode();
	if (detected === "none") return (mode = "none");
	const piMode = typeof theme?.getColorMode === "function" ? theme.getColorMode() : undefined;
	mode = piMode === "truecolor" || piMode === "256color" ? piMode : detected;
	return mode;
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

function nearestCubeIndex(value: number): number {
	let best = 0;
	for (let i = 1; i < CUBE_LEVELS.length; i++) {
		if (Math.abs(CUBE_LEVELS[i]! - value) < Math.abs(CUBE_LEVELS[best]! - value)) best = i;
	}
	return best;
}

function distanceSq(a: RGB, b: RGB): number {
	return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Nearest xterm-256 palette index (6×6×6 cube or 24-step gray ramp). */
export function rgbTo256([r, g, b]: RGB): number {
	const ri = nearestCubeIndex(r);
	const gi = nearestCubeIndex(g);
	const bi = nearestCubeIndex(b);
	const cube: RGB = [CUBE_LEVELS[ri]!, CUBE_LEVELS[gi]!, CUBE_LEVELS[bi]!];
	const avg = (r + g + b) / 3;
	const grayStep = Math.max(0, Math.min(23, Math.round((avg - 8) / 10)));
	const grayValue = 8 + grayStep * 10;
	const gray: RGB = [grayValue, grayValue, grayValue];
	const target: RGB = [r, g, b];
	return distanceSq(gray, target) < distanceSq(cube, target)
		? 232 + grayStep
		: 16 + 36 * ri + 6 * gi + bi;
}

function clampChannel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

/** Opening foreground sequence for the active mode ("" when colors are disabled). */
export function fgAnsi(rgb: RGB, colorMode: ColorMode = mode): string {
	if (colorMode === "none") return "";
	const c: RGB = [clampChannel(rgb[0]), clampChannel(rgb[1]), clampChannel(rgb[2])];
	return colorMode === "truecolor" ? `\x1b[38;2;${c[0]};${c[1]};${c[2]}m` : `\x1b[38;5;${rgbTo256(c)}m`;
}

/** Opening background sequence for the active mode ("" when colors are disabled). */
export function bgAnsi(rgb: RGB, colorMode: ColorMode = mode): string {
	if (colorMode === "none") return "";
	const c: RGB = [clampChannel(rgb[0]), clampChannel(rgb[1]), clampChannel(rgb[2])];
	return colorMode === "truecolor" ? `\x1b[48;2;${c[0]};${c[1]};${c[2]}m` : `\x1b[48;5;${rgbTo256(c)}m`;
}

/** Foreground-colored text that restores only the foreground afterwards. */
export function paintFg(rgb: RGB, text: string, colorMode: ColorMode = mode): string {
	const open = fgAnsi(rgb, colorMode);
	return open ? `${open}${text}\x1b[39m` : text;
}

export function hexToRgb(hex: string): RGB {
	const value = hex.replace(/^#/, "");
	const full = value.length === 3 ? [...value].map((ch) => ch + ch).join("") : value;
	const n = Number.parseInt(full, 16);
	if (!/^[0-9a-f]{6}$/i.test(full) || Number.isNaN(n)) return [255, 255, 255];
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
