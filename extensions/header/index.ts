import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fgAnsi, getColorMode, syncColorMode, type RGB } from "../shared/color";

const SAKURA: RGB = [242, 167, 198];
const PEACH: RGB = [246, 188, 154];
const LAVENDER: RGB = [199, 184, 245];
const SKY: RGB = [159, 211, 242];
const LABEL = "◈  SAKURA CYBERDECK  ◈";
/** Fixed blank rows above the artwork (independent of terminal height). */
export const TOP_PADDING = 1;

function gradient(text: string, from: RGB, to: RGB, bold = false): string {
  if (getColorMode() === "none") return text;
  const chars = [...text];
  const span = Math.max(1, chars.length - 1);
  const open = bold ? "\x1b[1m" : "";
  return chars.map((char, index) => {
    if (char === " ") return char;
    const t = index / span;
    const color: RGB = [
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    ];
    return `${open}${fgAnsi(color)}${char}\x1b[0m`;
  }).join("");
}

const ANIME_ART = [
  "⠀⠀⠂⠈⣿⣷⣿⣿⣿⡅⡹⢿⠆⠙⠋⠉⠻⠿⣿⣿⣿⣿⣿⣿⣮⠻⣦⡙⢷⡑⠘⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣌⠡⠌⠂⣙⠻⣛⠻⠷⠐⠈⠛⢱⣮⠁⠐⠀",
  "⠀⠂⠈⣿⡇⢿⢹⣿⣶⠐⠁⠀⣀⣠⣤⠄⠀⠀⠈⠙⠻⣿⣿⣿⣦⣵⣌⠻⣷⢝⠦⠚⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⢟⣻⣿⣊⡃⠀⣙⠿⣿⣿⣿⣎⢮⡀⢮⣽⠁⠐",
  "⠂⠈⣿⣿⣧⡸⡎⡛⡩⠖⠀⣴⣿⣿⣿⠀⠀⠀⠀⠸⠇⠀⠙⢿⣿⣿⣿⣷⣌⢷⣑⢷⣄⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⣫⠶⠛⠉⠀⠁⠀⠈⠈⠀⠠⠜⠻⣿⣆⢿⣼⣿⣿⠁",
  " ⠈⣿⣿⣿⣧⢧⣧⢻⣦⢀⣹⣿⣿⣿⣇⠀⠄⠀⠀⠀⡀⠀⠈⢻⣿⣿⣿⣿⣷⣝⢦⡹⠷⡙⢿⣿⣿⣿⣿⣿⣿⣿⣿⠈⠁⠀⠀⠀⠁⠀⠀⠀⠱⣶⣄⡀⠀⠈⠛⠜⣿⣿⣿⣿",
  "⠀⠊⢫⣿⣏⣿⡌⣼⣄⢫⡌⣿⣿⣿⣿⣿⣦⡈⠲⣄⣤⣤⡡⢀⣠⣿⣿⣿⣿⣿⣿⣷⣼⣍⢬⣦⡙⣿⣿⣿⣿⣿⣯⢁⡄⠀⡀⡀⠀⠄⢈⣠⢪⠀⣿⣿⣿⣦⠀⢉⢂⠹⡿⣿⣿",
  "⠀⠀⠄⢹⢃⢻⣟⠙⣿⣦⠱⢻⣿⣿⣿⣿⣿⣿⣷⣬⣍⣭⣥⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⡙⢿⣼⡿⣿⣿⣿⣿⣿⣷⣄⠘⣱⢦⣤⡴⡿⢈⣼⣿⣿⣿⣇⣴⣶⣮⣅⢻⣿⡏",
  "⠀⠀⠈⠹⣇⢡⢿⡆⠻⣿⣷⠀⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣍⡻⣿⣟⣻⣿⣿⣿⣿⣷⣦⣥⣬⣤⣴⣾⣿⣿⣿⣿⣷⣿⣿⣿⣿⣷⡜⠃",
  "⠀⠀⠀⢀⣘⠈⢂⠃⣧⡹⣿⣷⡄⠙⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣮⣅⡙⢿⣟⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠋⡕⠂",
  "⠀⠀⠀⠀⠀⠀⠛⢷⣜⢷⡌⠻⣿⣿⣦⣝⣻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣯⣹⣷⣦⣹⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠉⠃⠀",
] as const;

const ART_WIDTH = Math.max(...ANIME_ART.map((line) => [...line].length));

/** Centered left padding with an optical nudge, never pushing content past `width`. */
function centerPad(width: number, contentWidth: number, nudge = 0): string {
  const pad = Math.floor((width - contentWidth) / 2) + nudge;
  return " ".repeat(Math.max(0, Math.min(width - contentWidth, pad)));
}

/** Header lines; every line fits within `width` columns and the height never depends on the terminal. */
export function renderHeader(width: number): string[] {
  const w = Math.floor(width);
  if (!Number.isFinite(w) || w <= 0) return [];

  const artWidth = Math.min(w, ART_WIDTH);
  const artPad = centerPad(w, artWidth, -2);
  // Truncate after coloring: pi-tui's truncateToWidth is ANSI-aware and wide-char safe.
  const art = ANIME_ART.map((line) => `${artPad}${truncateToWidth(gradient(line, SAKURA, SKY), artWidth, "")}`);

  // Keep the divider visually subordinate: inset it symmetrically from the artwork.
  const railInset = artWidth >= 8 ? Math.max(2, Math.round(artWidth * 0.15)) : 0;
  const railWidth = Math.max(1, artWidth - railInset * 2);
  const rail = `${centerPad(w, railWidth, 1)}${gradient("━".repeat(railWidth), SAKURA, SKY)}`;

  const label = truncateToWidth(gradient(LABEL, LAVENDER, PEACH, true), w, "…");
  const labelLine = `${centerPad(w, visibleWidth(label), 1)}${label}`;

  return [...Array<string>(TOP_PADDING).fill(""), ...art, "", rail, labelLine, ""];
}

function isInteractiveTui(ctx: Pick<ExtensionContext, "mode" | "hasUI">): boolean {
  return typeof ctx.mode === "string" ? ctx.mode === "tui" : ctx.hasUI === true;
}

export default function sakuraCyberdeckHeader(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!isInteractiveTui(ctx)) return;
    syncColorMode(ctx.ui.theme);
    let cachedWidth = -1;
    let cachedLines: string[] = [];
    ctx.ui.setHeader(() => ({
      render(width: number): string[] {
        if (width !== cachedWidth) {
          cachedLines = renderHeader(width);
          cachedWidth = width;
        }
        return cachedLines;
      },
      invalidate() {
        cachedWidth = -1;
      },
    }));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (!isInteractiveTui(ctx)) return;
    try {
      ctx.ui.setHeader(undefined);
    } catch {
      // UI may already be disposed.
    }
  });
}
