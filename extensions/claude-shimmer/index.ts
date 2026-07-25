/**
 * Sakura-macaron Claude-style spinner for pi.
 *
 * Same state machine as pi-claude-shimmer, recolored for sakura-macaron:
 * - Verb shimmer sweeps sakura → peach → lavender → sky highlight
 * - Thinking glow breathes lavender ↔ petal white
 * - Stall fades toward coral; tools flash mint/sakura
 * - Whimsical verbs lean "atelier / confection" (OpenCode + Claude vibe)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// ─── Types ────────────────────────────────────────────────────────

type SpinnerMode = "requesting" | "thinking" | "responding" | "tool-input" | "tool-use";

// ─── Verbs (Claude Code spinner verbs + sakura extras) ─────────────

// Claude Code SPINNER_VERBS (+ sakura extras) · 217 total
const VERBS = [
  "Accomplishing", "Actioning", "Actualizing", "Analyzing", "Architecting",
  "Baking", "Beaming", "Beboppin'", "Befuddling", "Billowing",
  "Blanching", "Blooming", "Bloviating", "Boogieing", "Boondoggling",
  "Booping", "Bootstrapping", "Brewing", "Building", "Bunning",
  "Burrowing", "Calculating", "Canoodling", "Caramelizing", "Cascading",
  "Catapulting", "Cerebrating", "Channeling", "Channelling", "Choreographing",
  "Churning", "Clauding", "Coalescing", "Cogitating", "Combobulating",
  "Composing", "Computing", "Concocting", "Considering", "Contemplating",
  "Cooking", "Crafting", "Creating", "Crunching", "Crystallizing",
  "Cultivating", "Debugging", "Deciphering", "Decorating", "Deliberating",
  "Designing", "Determining", "Developing", "Dilly-dallying", "Discombobulating",
  "Doing", "Doodling", "Dreaming", "Drizzling", "Dusting",
  "Ebbing", "Effecting", "Elucidating", "Embellishing", "Enchanting",
  "Envisioning", "Evaluating", "Evaporating", "Examining", "Exploring",
  "Fermenting", "Fiddle-faddling", "Finagling", "Fixing", "Flambéing",
  "Flibbertigibbeting", "Flowing", "Flummoxing", "Fluttering", "Folding",
  "Forging", "Forming", "Frolicking", "Frosting", "Gallivanting",
  "Galloping", "Garnishing", "Generating", "Germinating", "Gesticulating",
  "Gitifying", "Glazing", "Grooving", "Gusting", "Harmonizing",
  "Hashing", "Hatching", "Herding", "Honking", "Hullaballooing",
  "Hyperspacing", "Ideating", "Imagining", "Implementing", "Improvising",
  "Incubating", "Inferring", "Infusing", "Inspecting", "Investigating",
  "Ionizing", "Jitterbugging", "Julienning", "Kneading", "Leavening",
  "Levitating", "Lollygagging", "Manifesting", "Mapping", "Marinating",
  "Meandering", "Metamorphosing", "Misting", "Moonwalking", "Moseying",
  "Mulling", "Musing", "Mustering", "Nebulizing", "Nesting",
  "Newspapering", "Noodling", "Nucleating", "Optimizing", "Orbiting",
  "Orchestrating", "Osmosing", "Painting", "Perambulating", "Percolating",
  "Perusing", "Philosophising", "Photosynthesizing", "Planning", "Polishing",
  "Pollinating", "Pondering", "Pontificating", "Pouncing", "Precipitating",
  "Prestidigitating", "Processing", "Proofing", "Propagating", "Puttering",
  "Puzzling", "Quantumizing", "Razzle-dazzling", "Razzmatazzing", "Recombobulating",
  "Refactoring", "Researching", "Reticulating", "Reviewing", "Roosting",
  "Ruminating", "Sautéing", "Scampering", "Schlepping", "Sculpting",
  "Scurrying", "Seasoning", "Shenaniganing", "Shimmying", "Simmering",
  "Skedaddling", "Sketching", "Slithering", "Smooshing", "Sock-hopping",
  "Solving", "Sparkling", "Spelunking", "Spinning", "Sprouting",
  "Stewing", "Sublimating", "Swirling", "Swooping", "Symbioting",
  "Synthesizing", "Tempering", "Thinking", "Thundering", "Tinkering",
  "Tomfoolering", "Topsy-turvying", "Transfiguring", "Transmuting", "Twisting",
  "Undulating", "Unfurling", "Unravelling", "Vibing", "Waddling",
  "Wandering", "Warping", "Weaving", "Whatchamacalliting", "Whirlpooling",
  "Whirring", "Whisking", "Wibbling", "Working", "Wrangling",
  "Zesting", "Zigzagging",
];

// Past-tense completion notify (Claude/upstream style)
const COMPLETION_VERBS = [
  "Baked", "Brewed", "Churned", "Cogitated", "Cooked",
  "Crunched", "Frosted", "Glazed", "Kneaded", "Polished",
  "Sautéed", "Simmered", "Sparkled", "Tempered", "Whisked",
  "Worked",
];

// ─── Glyphs ───────────────────────────────────────────────────────

// Claude-style spinner glyphs (same set for all modes)
const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽"];
// Arrow prefix per mode: ↑ for requesting, ↓ for everything else
const ARROW_REQUESTING = "↑";
const ARROW_WORKING = "↓";

// Ping-pong spinner frames (forward then reverse, like Claude Code)
const SPINNER_FRAMES = [...GLYPHS, ...[...GLYPHS].reverse()];

// ─── ANSI Colors ──────────────────────────────────────────────────

const RESET = "\x1b[0m";
// Sakura-macaron palette (truecolor, theme-aligned)
const SAKURA: [number, number, number] = [242, 167, 198]; // #F2A7C6
const PEACH: [number, number, number] = [252, 201, 185];  // #FCC9B9
const PETAL: [number, number, number] = [239, 195, 230];  // #EFC3E6
const LAVENDER: [number, number, number] = [199, 184, 245]; // #C7B8F5
const SKY: [number, number, number] = [159, 211, 242];    // #9FD3F2
const MINT: [number, number, number] = [174, 229, 197];   // #AEE5C5
const CORAL: [number, number, number] = [255, 143, 163];  // #FF8FA3
const MUTED: [number, number, number] = [169, 155, 174];  // #A99BAE
const DIM_RGB: [number, number, number] = [113, 104, 121]; // #716879
const HIGHLIGHT: [number, number, number] = [255, 248, 252]; // soft white petal

const ORANGE = `\x1b[38;2;${SAKURA[0]};${SAKURA[1]};${SAKURA[2]}m`; // spinner glyph tint
const DIM = `\x1b[38;2;${MUTED[0]};${MUTED[1]};${MUTED[2]}m`;

// ─── Timing Constants ─────────────────────────────────────────────

const SHIMMER_MS_REQUESTING = 45;   // slightly snappier send
const SHIMMER_MS_WORKING = 120;     // smoother receive sweep
const TOKEN_COUNTER_MS = 40;
const SHIMMER_BAND = 5;             // wider soft bloom
const SHOW_TIMER_AFTER_MS = 20_000; // show clock earlier (OpenCode-ish)
const THOUGHT_DISPLAY_MS = 4_000;
const STALL_TIMEOUT_MS = 3_000;
const STALL_ERROR_RED: [number, number, number] = CORAL;
const STALL_TRANSITION_FRAMES = 28;
const THINKING_GLOW_DELAY_MS = 1_800; // earlier glow
const THINKING_GLOW_PERIOD_MS = 1_600;
const THINKING_BASE_RGB: [number, number, number] = LAVENDER;
const THINKING_SHIMMER_RGB: [number, number, number] = HIGHLIGHT;

// ─── Helpers ──────────────────────────────────────────────────────

function pickVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)]!;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function formatTokenCount(n: number): string {
  const value = Math.max(0, Math.round(n));
  const number = value < 1_000
    ? new Intl.NumberFormat("en-US").format(value)
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value).replace("K", "k");
  return `${number} ${value === 1 ? "token" : "tokens"}`;
}

/**
 * Trailing dots with FIXED width 3 so the status HUD never shifts when
 * the ellipsis animates (.  / .. / ...).
 * ~8 shimmer frames per step ≈ 1s/step at 120ms tick (calm, not frantic).
 */
function animatedDots(frame: number): string {
  const cycle = [".  ", ".. ", "..."] as const;
  return cycle[Math.floor(frame / 8) % cycle.length]!;
}

/** Token count — always sky (same as ↑/↓); ~ marks live fallback estimates. */
function styleTokenCount(n: number, estimated: boolean): string {
  return rgbAnsi(SKY, `${estimated ? "~" : ""}${formatTokenCount(n)}`);
}

export type AssistantTokenMessage = {
  content?: Array<{
    type?: string;
    text?: string;
    thinking?: string;
    name?: string;
    arguments?: unknown;
  }>;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
  };
};

export function reportedOutputTokens(
  message: AssistantTokenMessage | undefined,
  final = false,
): number | null {
  const usage = message?.usage;
  const output = usage?.output;
  if (typeof output !== "number" || !Number.isFinite(output) || output < 0) return null;
  if (output > 0) return Math.round(output);
  // Streaming messages start with a zero-filled Usage object. At message_end, non-zero
  // input/cache/total proves the provider really reported usage, so output=0 is valid.
  const hasFinalUsage = final && [
    usage?.input,
    usage?.cacheRead,
    usage?.cacheWrite,
    usage?.totalTokens,
  ].some((value) => typeof value === "number" && value > 0);
  return hasFinalUsage ? 0 : null;
}

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const EMOJI_CHAR = /\p{Extended_Pictographic}/u;

/** Quarter-token units make estimates additive across streamed deltas. */
function estimateTextTokenUnits(text: string): number {
  let units = 0;
  for (const char of text) {
    if (char.codePointAt(0)! <= 0x7f) units += 1; // ≈ 4 ASCII chars/token
    else if (EMOJI_CHAR.test(char)) units += 8; // ≈ 2 tokens
    else if (CJK_CHAR.test(char)) units += 4; // ≈ 1 token
    else units += 2;
  }
  return units;
}

/** Better live fallback than chars/4 for CJK/emoji; final provider usage replaces it. */
export function estimateTextTokens(text: string): number {
  return Math.max(0, Math.ceil(estimateTextTokenUnits(text) / 4));
}

function estimateBlockTokenUnits(block: NonNullable<AssistantTokenMessage["content"]>[number]): number {
  if (block.type === "text" && typeof block.text === "string") {
    return estimateTextTokenUnits(block.text);
  }
  if (block.type === "thinking" && typeof block.thinking === "string") {
    return estimateTextTokenUnits(block.thinking);
  }
  if (block.type === "toolCall") {
    let text = block.name ?? "";
    try {
      text += JSON.stringify(block.arguments ?? {});
    } catch {}
    return estimateTextTokenUnits(text);
  }
  return 0;
}

export function estimateOutputTokens(message: AssistantTokenMessage | undefined): number {
  const units = message?.content?.reduce((sum, block) => sum + estimateBlockTokenUnits(block), 0) ?? 0;
  return Math.max(0, Math.ceil(units / 4));
}

// ─── Shimmer Engine ───────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function blend(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Sample fixed sakura → sky macaron stops (0..1). */
function sampleMacaron(pos: number): [number, number, number] {
  const stops: [number, number, number][] = [SAKURA, PEACH, PETAL, LAVENDER, SKY];
  const n = Math.max(0, Math.min(1, pos));
  const scaled = n * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  return blend(stops[i]!, stops[i + 1]!, scaled - i);
}

/**
 * Macaron color-sweep: base walk along sakura→sky, with a soft white bloom band.
 * reverse = true sweeps right→left (working/thinking).
 */
function colorSweep(
  text: string,
  frame: number,
  _baseHex: string,
  _shimmerHex: string,
  reverse: boolean,
): string {
  const total = text.length + SHIMMER_BAND * 2;
  const rawPos = frame % total;
  const pos = reverse ? total - 1 - rawPos : rawPos;

  let out = "";
  for (let i = 0; i < text.length; i++) {
    const basePos = text.length <= 1 ? 0 : i / (text.length - 1);
    const base = sampleMacaron(basePos);
    const dist = Math.abs(i - pos);
    const t = Math.max(0, 1 - dist / SHIMMER_BAND);
    // Soft bloom toward petal-white; ease-out so edges stay pastel.
    const ease = t * t;
    const c = blend(base, HIGHLIGHT, ease * 0.92);
    out += `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${text[i]}`;
  }
  out += RESET;
  return out;
}

function rgbAnsi(c: [number, number, number], text: string): string {
  return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${text}${RESET}`;
}

// ─── Extension ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── State ───────────────────────────────────────────────────

  let mode: SpinnerMode = "requesting";
  let verb = "";
  let agentStart = 0;
  let turnStart = 0;
  let thinkingStart = 0;
  let thinkingDuration: number | null = null;
  let thoughtSetAt = 0;
  let completedOutputTokens = 0;
  let currentEstimatedTokens = 0;
  let currentReportedTokens: number | null = null;
  const currentBlockTokenUnits = new Map<number, number>();
  let currentEstimatedTokenUnits = 0;
  let lastTokenTime = 0;
  let turnActive = false;
  let activeToolCount = 0;

  // Stall smooth interpolation (0→1)
  let _stallFrame = 0;
  // Smooth cumulative output-token animation. Provider usage can correct either direction.
  let _displayedTokens = 0;
  let _tokensMoving = false;

  // Timers
  let shimmerTimer: ReturnType<typeof setInterval> | null = null;
  let tokenTimer: ReturnType<typeof setInterval> | null = null;
  let shimmerFrame = 0;
  let thoughtTimer: ReturnType<typeof setTimeout> | null = null;

  // State
  let ctx_: ExtensionContext | null = null;

  // ── Helpers ─────────────────────────────────────────────────

  /**
   * Pi ThinkingLevel: off | minimal | low | medium | high | xhigh | max
   * Label + macaron color per tier (matches sakura-macaron thinking* theme tokens).
   */
  function getEffortInfo(): { tag: string; color: [number, number, number] } | undefined {
    try {
      const level = (pi.getThinkingLevel() || "").toLowerCase();
      if (!level || level === "off") return undefined;
      // Colors align with theme thinkingMinimal→thinkingMax scale.
      const map: Record<string, { tag: string; color: [number, number, number] }> = {
        minimal: { tag: "MINIMAL", color: MUTED },
        low: { tag: "LOW", color: SKY },
        medium: { tag: "MEDIUM", color: PETAL },
        high: { tag: "HIGH", color: SAKURA },
        xhigh: { tag: "XHIGH", color: LAVENDER },
        max: { tag: "MAX", color: CORAL },
      };
      return map[level] ?? { tag: level.toUpperCase(), color: LAVENDER };
    } catch {
      return undefined;
    }
  }

  /** Digital clock — fixed mm:ss (or h:mm:ss with padded h). */
  function formatDigital(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    if (h <= 0) return `${mm}:${ss}`;
    // Keep colon pattern stable; pad hours to 2 when small.
    const hh = String(h).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  /** Effort label — stable for the whole turn; never swapped for SEND/RECV/TOOL. */
  function effortTagStyled(): string | undefined {
    const info = getEffortInfo();
    // Only show when we have a real level, or while/after thinking with unknown level.
    const tag = info?.tag ?? (mode === "thinking" || thinkingDuration !== null ? "THINK" : "");
    if (!tag) return undefined;
    const base = info?.color ?? LAVENDER;

    // Soft glow while actively thinking (base tier color → petal white).
    if (mode === "thinking" && thinkingDuration === null) {
      const thinkElapsed = Date.now() - thinkingStart;
      if (thinkElapsed > THINKING_GLOW_DELAY_MS) {
        const sec = (thinkElapsed - THINKING_GLOW_DELAY_MS) / 1000;
        const opacity = (Math.sin((sec * Math.PI * 2) / (THINKING_GLOW_PERIOD_MS / 1000)) + 1) / 2;
        const c = blend(base, HIGHLIGHT, opacity);
        return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${tag}\x1b[0m`;
      }
    }
    return rgbAnsi(base, tag);
  }

  /**
   * Inner status fields, joined later inside one pair of ().
   * Separator matches upstream: " · ".
   */
  function buildStatusParts(): string[] {
    const elapsed = Date.now() - (agentStart || turnStart);
    const tokens = Math.round(Math.max(0, _displayedTokens));
    const estimated = currentReportedTokens === null && currentEstimatedTokens > 0;
    // Show token chip for any active stream phase (incl. requesting after start).
    const showTokens = turnActive || tokens > 0;
    // Clock once turn is live — same rules as tokens so fields appear together.
    const showTimer = turnActive || elapsed > 0;
    const parts: string[] = [];

    // 1) Effort — stable, tier-colored (MINIMAL…MAX)
    const effortPart = effortTagStyled();
    if (effortPart) parts.push(effortPart);

    // 2) Thought duration — same digital family as wall clock (00:03), petal tint
    if (thinkingDuration !== null) {
      parts.push(rgbAnsi(PETAL, formatDigital(thinkingDuration)));
    }

    // 3) Tokens — provider output usage; ~ means live fallback estimate.
    if (showTokens) {
      const arrow = mode === "requesting" ? ARROW_REQUESTING : ARROW_WORKING;
      const count = styleTokenCount(tokens, estimated);
      parts.push(`${rgbAnsi(SKY, arrow)} ${count}`);
    }

    // 4) Wall clock — muted, fixed mm:ss
    if (showTimer) {
      parts.push(rgbAnsi(MUTED, formatDigital(elapsed)));
    }

    // Stall is only reflected in verb color (coral fade) — no STALL chip.
    return parts;
  }

  /**
   * Upstream pi-claude-shimmer layout:
   *   verb… (part · part · part)
   * Outer () + inner " · "; brackets stay fixed-width thanks to padded dots.
   */
  function wrapStatusHud(parts: string[]): string {
    if (parts.length === 0) return "";
    // One space inside each paren: ( HIGH · ↓ 0 · 00:12 )
    return `${DIM}( ${parts.join(" · ")} )${RESET}`;
  }

  function isStalled(): boolean {
    return (
      mode !== "tool-use" &&
      mode !== "tool-input" &&
      activeToolCount === 0 &&
      turnActive &&
      lastTokenTime > 0 &&
      Date.now() - lastTokenTime > STALL_TIMEOUT_MS
    );
  }

  function buildShimmerMessage(): string {
    const parts = buildStatusParts();
    const reverse = mode !== "requesting";
    // Kept as hex for stall blend path; colorSweep ignores them (uses macaron stops).
    const baseHex = "#F2A7C6";
    const shimmerHex = "#FFF8FC";
    const stalled = _stallFrame > 0;
    // Live trailing dots so "Dusting" never looks frozen
    const dots = animatedDots(shimmerFrame);
    const verbWithDots = `${verb}${dots}`;

    let verbText: string;

    if (mode === "tool-use") {
      // Flash: sakura ↔ mint (tool busy) or coral when stalled
      const flashOpacity = (Math.sin((shimmerFrame * SHIMMER_MS_WORKING / 1000) * Math.PI) + 1) / 2;
      if (stalled) {
        const stallT = _stallFrame / STALL_TRANSITION_FRAMES;
        const stallC = blend(SAKURA, STALL_ERROR_RED, stallT);
        const flashC = blend(stallC, CORAL, flashOpacity);
        verbText = `\x1b[38;2;${flashC[0]};${flashC[1]};${flashC[2]}m${verbWithDots}\x1b[0m`;
      } else {
        const c = blend(SAKURA, MINT, flashOpacity);
        verbText = `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${verbWithDots}\x1b[0m`;
      }
    } else if (stalled) {
      // Smooth stall: gradually blend to coral, still sweep + dots
      const stallT = _stallFrame / STALL_TRANSITION_FRAMES;
      const baseC = hexToRgb(baseHex);
      const shimC = hexToRgb(shimmerHex);
      const stallBase = blend(baseC, STALL_ERROR_RED, stallT);
      const stallShimmer = blend(shimC, CORAL, stallT);
      const baseHexStr = `#${stallBase[0].toString(16).padStart(2,"0")}${stallBase[1].toString(16).padStart(2,"0")}${stallBase[2].toString(16).padStart(2,"0")}`;
      const shimmerHexStr = `#${stallShimmer[0].toString(16).padStart(2,"0")}${stallShimmer[1].toString(16).padStart(2,"0")}${stallShimmer[2].toString(16).padStart(2,"0")}`;
      verbText = colorSweep(verbWithDots, shimmerFrame, baseHexStr, shimmerHexStr, reverse);
    } else {
      verbText = colorSweep(verbWithDots, shimmerFrame, baseHex, shimmerHex, reverse);
    }

    // One outer [] HUD; dots are fixed-width so this never shifts.
    const hud = wrapStatusHud(parts);
    return hud ? `${verbText} ${hud}` : verbText;
  }

  function updateDisplay() {
    if (!ctx_?.ui) return;
    ctx_.ui.setWorkingMessage(buildShimmerMessage());
  }

  function startShimmer() {
    stopShimmer();
    shimmerFrame = 0;
    updateDisplay();
    const intervalMs = mode === "requesting" ? SHIMMER_MS_REQUESTING : SHIMMER_MS_WORKING;
    shimmerTimer = setInterval(() => {
      shimmerFrame++;
      // Stall smooth interpolation
      const stalled = isStalled();
      if (stalled && _stallFrame < STALL_TRANSITION_FRAMES) {
        _stallFrame++;
      } else if (!stalled && _stallFrame > 0) {
        _stallFrame--;
      }
      updateDisplay();
    }, intervalMs);
    startTokenCounter();
  }

  function stopShimmer() {
    if (shimmerTimer) {
      clearInterval(shimmerTimer);
      shimmerTimer = null;
    }
    stopTokenCounter();
  }

  // Token counter runs independently of shimmer. Completed turns use provider-reported
  // output usage; current streaming turn uses reported usage when available, else estimate.
  function startTokenCounter() {
    if (tokenTimer) return;
    tokenTimer = setInterval(() => {
      const current = currentReportedTokens ?? currentEstimatedTokens;
      const target = Math.max(0, completedOutputTokens + current);
      const gap = target - _displayedTokens;
      if (gap !== 0) {
        const distance = Math.abs(gap);
        const step =
          distance < 8 ? distance :
          distance < 40 ? Math.max(2, Math.ceil(distance * 0.28)) :
          distance < 200 ? Math.max(8, Math.ceil(distance * 0.2)) :
          Math.max(24, Math.ceil(distance * 0.14));
        _displayedTokens += Math.sign(gap) * Math.min(distance, step);
        _tokensMoving = true;
        updateDisplay();
      } else if (_tokensMoving) {
        _tokensMoving = false;
        updateDisplay();
      }
    }, TOKEN_COUNTER_MS);
  }

  function stopTokenCounter() {
    if (tokenTimer) {
      clearInterval(tokenTimer);
      tokenTimer = null;
    }
  }

  function setGlyphs() {
    if (!ctx_?.ui) return;
    const intervalMs = 120;
    ctx_.ui.setWorkingIndicator({
      frames: SPINNER_FRAMES.map((g) => ORANGE + g + RESET),
      intervalMs,
    });
  }

  function setMode(newMode: SpinnerMode) {
    if (mode === newMode) return;
    mode = newMode;
    setGlyphs();
    // Restart shimmer timer with mode-appropriate interval
    if (shimmerTimer) {
      stopShimmer();
      startShimmer();
    }
  }

  function onThinkingEnd() {
    if (thinkingDuration !== null) return;
    const dur = Date.now() - thinkingStart;
    thinkingDuration = dur;
    thoughtSetAt = Date.now();
    scheduleThoughtClear();
  }

  function scheduleThoughtClear() {
    if (thoughtTimer) clearTimeout(thoughtTimer);
    if (thinkingDuration === null) return;
    const remaining = THOUGHT_DISPLAY_MS - (Date.now() - thoughtSetAt);
    if (remaining <= 0) {
      thinkingDuration = null;
      updateDisplay();
      return;
    }
    thoughtTimer = setTimeout(() => {
      thoughtTimer = null;
      if (Date.now() - thoughtSetAt < THOUGHT_DISPLAY_MS) {
        scheduleThoughtClear();
        return;
      }
      thinkingDuration = null;
      updateDisplay();
    }, remaining);
  }

  function setEstimatedBlock(index: number, units: number) {
    const next = Math.max(0, units);
    const previous = currentBlockTokenUnits.get(index) ?? 0;
    currentBlockTokenUnits.set(index, next);
    currentEstimatedTokenUnits += next - previous;
    currentEstimatedTokens = Math.ceil(currentEstimatedTokenUnits / 4);
  }

  function appendEstimatedBlock(index: number, text: string) {
    setEstimatedBlock(index, (currentBlockTokenUnits.get(index) ?? 0) + estimateTextTokenUnits(text));
  }

  function resetTurn(resetOutput = false) {
    stopShimmer();
    if (thoughtTimer) {
      clearTimeout(thoughtTimer);
      thoughtTimer = null;
    }
    ctx_?.ui?.setWorkingMessage();
    mode = "requesting";
    thinkingDuration = null;
    currentBlockTokenUnits.clear();
    currentEstimatedTokenUnits = 0;
    currentEstimatedTokens = 0;
    currentReportedTokens = null;
    if (resetOutput) {
      completedOutputTokens = 0;
      _displayedTokens = 0;
      _tokensMoving = false;
    }
    _stallFrame = 0;
    lastTokenTime = 0;
    activeToolCount = 0;
    setGlyphs();
  }

  // ── Events ──────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    ctx_ = ctx;
  });

  // Initialize shimmer state. Factored out so both agent_start and turn_start
  // can call it; turn_start skips when already initialized by agent_start.
  function initTurn(resetOutput = false) {
    turnActive = true;
    turnStart = Date.now();
    if (!agentStart) agentStart = turnStart;
    verb = pickVerb();
    resetTurn(resetOutput);
    setMode("requesting");
    startShimmer();
  }

  // agent_start fires before turn_start and is the moment pi rebuilds the
  // working loader. Initialize shimmer here so the loader picks up our
  // message + indicator immediately instead of flashing "Working...".
  pi.on("agent_start", async (_event, ctx) => {
    ctx_ = ctx;
    if (!agentStart) agentStart = Date.now();
    if (!turnActive) initTurn(true);
  });

  pi.on("turn_start", async (_event, ctx) => {
    ctx_ = ctx;
    if (turnActive) return;   // already initialized by agent_start
    initTurn();
  });

  pi.on("message_update", async (event, ctx) => {
    ctx_ = ctx;
    const evt = event.assistantMessageEvent;
    // Pi forwards only non-terminal stream events here; final usage arrives via message_end.
    const tokenMessage = event.message as AssistantTokenMessage;
    const reported = reportedOutputTokens(tokenMessage);
    if (reported !== null) currentReportedTokens = reported;

    // Incremental fallback estimate. Streams may interleave blocks, so key by contentIndex.
    switch (evt.type) {
      case "start":
        currentBlockTokenUnits.clear();
        currentEstimatedTokenUnits = 0;
        currentEstimatedTokens = 0;
        break;
      case "text_start":
      case "thinking_start":
        setEstimatedBlock(evt.contentIndex, 0);
        break;
      case "text_delta":
      case "thinking_delta":
      case "toolcall_delta":
        appendEstimatedBlock(evt.contentIndex, evt.delta);
        break;
      case "text_end":
      case "thinking_end":
        setEstimatedBlock(evt.contentIndex, estimateTextTokenUnits(evt.content));
        break;
      case "toolcall_start":
        setEstimatedBlock(
          evt.contentIndex,
          tokenMessage.content?.[evt.contentIndex]
            ? estimateBlockTokenUnits(tokenMessage.content[evt.contentIndex]!)
            : 0,
        );
        break;
      case "toolcall_end": {
        let text = evt.toolCall.name;
        try {
          text += JSON.stringify(evt.toolCall.arguments ?? {});
        } catch {}
        setEstimatedBlock(evt.contentIndex, estimateTextTokenUnits(text));
        break;
      }
    }

    switch (evt.type) {
      case "thinking_start":
        setMode("thinking");
        thinkingStart = Date.now();
        thinkingDuration = null;
        if (thoughtTimer) {
          clearTimeout(thoughtTimer);
          thoughtTimer = null;
        }
        break;

      case "thinking_delta":
        setMode("thinking");
        lastTokenTime = Date.now();
        break;

      case "thinking_end":
        onThinkingEnd();
        break;

      case "text_start":
        if (mode !== "responding") {
          setMode("responding");
        }
        lastTokenTime = Date.now();
        break;

      case "text_delta":
        if (mode !== "responding") {
          setMode("responding");
        }
        lastTokenTime = Date.now();
        break;

      case "text_end":
        break;

      case "toolcall_start":
        setMode("tool-input");
        break;
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    ctx_ = ctx;
    const finalMessage = event.message as AssistantTokenMessage;
    const reported = reportedOutputTokens(finalMessage, true);
    const estimated = estimateOutputTokens(finalMessage);
    // Exactly once per finalized assistant message. This preserves totals across tool turns.
    completedOutputTokens += reported ?? estimated;
    currentBlockTokenUnits.clear();
    currentEstimatedTokenUnits = 0;
    currentEstimatedTokens = 0;
    currentReportedTokens = null;
    // Snap at provider completion so estimates can correct downward before tool execution.
    _displayedTokens = completedOutputTokens;
    _tokensMoving = false;
    updateDisplay();
  });

  pi.on("tool_execution_start", async (_event, ctx) => {
    ctx_ = ctx;
    activeToolCount++;
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    ctx_ = ctx;
    activeToolCount = Math.max(0, activeToolCount - 1);
    // After all tools finish, switch back to responding if the turn is still active
    if (activeToolCount === 0 && (mode === "tool-use" || mode === "tool-input") && turnActive) {
      setMode("responding");
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    ctx_ = ctx;
    turnActive = false;
    stopShimmer();

    if (thinkingDuration !== null && Date.now() - thoughtSetAt >= THOUGHT_DISPLAY_MS) {
      thinkingDuration = null;
    }

    activeToolCount = 0;
  });

  pi.on("agent_end", async () => {
    turnActive = false;
    stopShimmer();

    // Save elapsed before resetting turn state
    const elapsed = Date.now() - (turnStart || agentStart || Date.now());

    agentStart = 0;

    if (ctx_?.ui) {
      const done = COMPLETION_VERBS[Math.floor(Math.random() * COMPLETION_VERBS.length)];
      const glyph = rgbAnsi(SAKURA, "✻");
      const body = rgbAnsi(MUTED, ` ${done} for ${formatDuration(elapsed)}`);
      ctx_.ui.notify(`${glyph}${body}`, "success");
    }
  });

  pi.on("session_shutdown", async () => {
    turnActive = false;
    stopShimmer();
    if (thoughtTimer) {
      clearTimeout(thoughtTimer);
      thoughtTimer = null;
    }
    ctx_ = null;
  });
}
