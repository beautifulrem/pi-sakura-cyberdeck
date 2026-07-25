import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "dual-subscription-quota";
const CODEX_PROVIDER = "openai-codex";
const XAI_PROVIDER = "xai-auth";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const XAI_USER_URL = "https://cli-chat-proxy.grok.com/v1/user";
const XAI_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const COUNTDOWN_TICK_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;

// Keep this aligned with the installed OAuth provider's reviewed Grok wire contract.
const XAI_CLIENT_VERSION = installedXaiProviderVersion();

type ProviderName = "codex" | "grok";
type TimeoutHandle = ReturnType<typeof setTimeout> & { unref?: () => void };
type PiModel = NonNullable<ExtensionContext["model"]>;
type OAuthAwareRegistry = {
  isUsingOAuth?: (model: PiModel) => boolean;
  getProviderAuthStatus?: (provider: string) => { source?: string } | undefined;
};

type QuotaSnapshot = {
  remainingPercent: number;
  resetAt?: number;
  fetchedAt: number;
};

type ProviderState = {
  snapshot?: QuotaSnapshot;
  problem?: "auth" | "error";
  stale?: boolean;
};

type QuotaState = Record<ProviderName, ProviderState>;

class AuthUnavailableError extends Error {}

export default function dualQuota(pi: ExtensionAPI) {
  let state: QuotaState = { codex: {}, grok: {} };
  let currentContext: ExtensionContext | undefined;
  let tickTimer: TimeoutHandle | undefined;
  let pulseTimer: TimeoutHandle | undefined;
  let refreshController: AbortController | undefined;
  let refreshPromise: Promise<void> | undefined;
  let lastPollAt = 0;
  let generation = 0;

  const render = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, renderStatus(state, ctx));
  };

  const stop = (ctx?: ExtensionContext) => {
    generation += 1;
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = undefined;
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = undefined;
    refreshController?.abort();
    refreshController = undefined;
    refreshPromise = undefined;
    try {
      (ctx ?? currentContext)?.ui.setStatus(STATUS_KEY, undefined);
    } catch {
      // A replaced session can make the previous context stale during cleanup.
    }
    currentContext = undefined;
  };

  const scheduleTick = () => {
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = setTimeout(() => {
      tickTimer = undefined;
      const ctx = currentContext;
      if (!ctx) return;
      if (Date.now() - lastPollAt >= POLL_INTERVAL_MS) {
        void refresh(ctx, false);
      } else {
        render(ctx);
      }
      scheduleTick();
    }, COUNTDOWN_TICK_MS) as TimeoutHandle;
    tickTimer.unref?.();
  };

  const schedulePulse = () => {
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => {
      pulseTimer = undefined;
      const ctx = currentContext;
      if (!ctx) return;
      render(ctx);
      schedulePulse();
    }, PULSE_TICK_MS) as TimeoutHandle;
    pulseTimer.unref?.();
  };

  const refresh = (ctx: ExtensionContext, force: boolean): Promise<void> => {
    currentContext = ctx;
    if (refreshPromise) return refreshPromise;
    if (!force && lastPollAt > 0 && Date.now() - lastPollAt < POLL_INTERVAL_MS) {
      render(ctx);
      return Promise.resolve();
    }

    lastPollAt = Date.now();
    const requestGeneration = generation;
    const controller = new AbortController();
    refreshController = controller;

    if (!state.codex.snapshot && !state.grok.snapshot) render(ctx);

    const pending = Promise.allSettled([
      fetchCodexQuota(ctx, controller.signal),
      fetchGrokQuota(ctx, controller.signal),
    ])
      .then(([codexResult, grokResult]) => {
        if (controller.signal.aborted || requestGeneration !== generation) return;
        state = {
          codex: mergeResult(state.codex, codexResult),
          grok: mergeResult(state.grok, grokResult),
        };
        render(ctx);
      })
      .finally(() => {
        if (refreshController === controller) refreshController = undefined;
        if (refreshPromise === pending) refreshPromise = undefined;
      });

    refreshPromise = pending;
    return pending;
  };

  pi.on("session_start", (_event, ctx) => {
    stop();
    state = { codex: {}, grok: {} };
    // Quotas are presentation-only; avoid credentials, network requests, and
    // timers in print/JSON modes where no status surface can consume them.
    if (!ctx.hasUI) return;
    currentContext = ctx;
    lastPollAt = 0;
    render(ctx);
    void refresh(ctx, true);
    scheduleTick();
    schedulePulse();
  });

  // Deliberately do not gate or clear on model changes: both subscriptions stay visible.
  pi.on("model_select", (_event, ctx) => {
    currentContext = ctx;
    render(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => stop(ctx));

  pi.registerCommand("dual-usage", {
    description: "Refresh and show the persistent Codex + Grok subscription quotas",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await refresh(ctx, true);
      const plain = renderPlainStatus(state);
      ctx.ui.notify(`${plain}\nPercentages are subscription quota remaining.`, "info");
    },
  });
}

function installedXaiProviderVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(join(getAgentDir(), "npm", "node_modules", "pi-xai-oauth", "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof packageJson.version === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(packageJson.version)
      ? packageJson.version
      : "1.3.6";
  } catch {
    return "1.3.6";
  }
}

function mergeResult(
  previous: ProviderState,
  result: PromiseSettledResult<QuotaSnapshot>,
): ProviderState {
  if (result.status === "fulfilled") return { snapshot: result.value };
  const problem = result.reason instanceof AuthUnavailableError ? "auth" : "error";
  if (previous.snapshot) return { ...previous, problem, stale: true };
  return { problem };
}

async function fetchCodexQuota(
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<QuotaSnapshot> {
  const model = findOAuthModel(ctx, CODEX_PROVIDER);
  if (!model) throw new AuthUnavailableError("Codex OAuth is unavailable");

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new AuthUnavailableError("Codex OAuth could not be resolved");
  const headers = withBearer(auth.headers ?? {}, auth.apiKey);
  if (!hasHeader(headers, "Authorization")) {
    throw new AuthUnavailableError("Codex OAuth did not provide a bearer");
  }
  if (!hasHeader(headers, "User-Agent")) headers["User-Agent"] = "pi-dual-quota";

  const payload = await requestJson(CODEX_USAGE_URL, headers, signal);
  const rateLimit = objectValue(payload.rate_limit);
  const window = objectValue(rateLimit?.secondary_window) ?? objectValue(rateLimit?.primary_window);
  const used = numberValue(window?.used_percent);
  if (used === undefined) throw new Error("Codex quota response had no usage window");

  return {
    remainingPercent: 100 - clampPercent(used),
    resetAt: resetTimestamp(window, Date.now()),
    fetchedAt: Date.now(),
  };
}

async function fetchGrokQuota(
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<QuotaSnapshot> {
  const model = findOAuthModel(ctx, XAI_PROVIDER);
  if (!model) throw new AuthUnavailableError("Grok OAuth is unavailable");

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new AuthUnavailableError("Grok OAuth could not be resolved");
  const bearer = auth.apiKey ?? bearerFromHeaders(auth.headers ?? {});
  if (!bearer) throw new AuthUnavailableError("Grok OAuth did not provide a bearer");

  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${bearer}`,
    "X-XAI-Token-Auth": "xai-grok-cli",
    "x-grok-client-version": XAI_CLIENT_VERSION,
    "x-grok-client-mode": "interactive",
  };
  const identity = await requestJson(XAI_USER_URL, baseHeaders, signal);
  const userId = safeUserId(identity.userId);
  if (!userId) throw new Error("Grok account identity was unavailable");

  const billing = await requestJson(
    XAI_BILLING_URL,
    { ...baseHeaders, "x-userid": userId },
    signal,
  );
  const config = objectValue(billing.config);
  if (!config) throw new Error("Grok quota response had no billing config");
  const used = grokUsedPercent(config);
  const period = objectValue(config.currentPeriod);

  return {
    remainingPercent: 100 - clampPercent(used),
    resetAt: timestampValue(period?.end ?? config.billingPeriodEnd),
    fetchedAt: Date.now(),
  };
}

function findOAuthModel(ctx: ExtensionContext, provider: string): PiModel | undefined {
  const registry = ctx.modelRegistry as unknown as OAuthAwareRegistry;
  const models: PiModel[] = [];
  const seen = new Set<string>();
  const add = (model: PiModel | undefined) => {
    if (!model || model.provider !== provider) return;
    const key = `${model.provider}/${model.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    models.push(model);
  };

  add(ctx.model);
  for (const model of ctx.modelRegistry.getAvailable()) add(model);
  for (const model of ctx.modelRegistry.getAll()) add(model);

  return models.find((model) => {
    try {
      if (typeof registry.isUsingOAuth === "function" && !registry.isUsingOAuth(model)) return false;
      if (typeof registry.getProviderAuthStatus === "function") {
        const status = registry.getProviderAuthStatus(provider);
        if (status?.source === "runtime") return false;
      }
      return true;
    } catch {
      return false;
    }
  });
}

async function requestJson(
  url: string,
  headers: Record<string, string>,
  outerSignal: AbortSignal,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  outerSignal.addEventListener("abort", forwardAbort, { once: true });
  if (outerSignal.aborted) controller.abort();

  try {
    const response = await fetch(url, {
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) {
        throw new AuthUnavailableError(`OAuth was rejected with status ${response.status}`);
      }
      throw new Error(`Usage request failed with status ${response.status}`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("Usage response was too large");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("Usage response was too large");
    }
    const value = JSON.parse(text) as unknown;
    const object = objectValue(value);
    if (!object) throw new Error("Usage response was not an object");
    return object;
  } catch (error) {
    if (outerSignal.aborted) throw new Error("Usage refresh was cancelled");
    if (timedOut) throw new Error("Usage refresh timed out");
    if (error instanceof AuthUnavailableError) throw error;
    throw new Error("Usage refresh failed");
  } finally {
    clearTimeout(timeout);
    outerSignal.removeEventListener("abort", forwardAbort);
  }
}

const GAUGE_CELLS = 6;
const PULSE_PERIOD_MS = 1800;
const PULSE_TICK_MS = 120;

// Same sakura-macaron stops as neon-cyberdeck-header / zentui gradient.
type RGB = readonly [number, number, number];
const MACARON_STOPS: readonly RGB[] = [
  [242, 167, 198], // sakura  #F2A7C6
  [252, 201, 185], // peach   #FCC9B9
  [199, 184, 245], // lavender #C7B8F5
  [159, 211, 242], // sky     #9FD3F2
];
const CODEX_TINT: RGB = [159, 211, 242]; // sky
const GROK_TINT: RGB = [242, 167, 198]; // sakura
const WARN_TINT: RGB = [243, 217, 139]; // butter
const ERROR_TINT: RGB = [255, 143, 163]; // coral

type ProviderId = "codex" | "grok";

function pulsePhase(now = Date.now()): number {
  return ((now % PULSE_PERIOD_MS) + PULSE_PERIOD_MS) % PULSE_PERIOD_MS / PULSE_PERIOD_MS;
}

function rgb([r, g, b]: RGB, text: string, bold = false): string {
  const open = bold ? "\x1b[1m" : "";
  const close = bold ? "\x1b[22m\x1b[39m" : "\x1b[39m";
  return `${open}\x1b[38;2;${r};${g};${b}m${text}${close}`;
}

function mix(from: RGB, to: RGB, amount: number): RGB {
  const t = Math.max(0, Math.min(1, amount));
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

function sampleMacaron(position: number, phase = 0): RGB {
  const stops = MACARON_STOPS;
  const normalized = ((Math.max(0, Math.min(1, position)) + phase) % 1 + 1) % 1;
  const scaled = normalized * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const from = stops[index] ?? MACARON_STOPS[0]!;
  const to = stops[index + 1] ?? from;
  return mix(from, to, scaled - index);
}

function providerTint(id: ProviderId): RGB {
  return id === "codex" ? CODEX_TINT : GROK_TINT;
}

function providerLabel(id: ProviderId): string {
  return id === "codex" ? "Codex" : "Grok";
}

/** Empty track — soft lilac, not dead black-grey. */
const TRACK: RGB = [160, 148, 168];
const EMPTY: RGB = [200, 188, 204];

function tierTint(percent: number, id: ProviderId): RGB {
  if (percent >= 50) return providerTint(id);
  if (percent >= 20) return WARN_TINT;
  return ERROR_TINT;
}

/**
 * Compact macaron gauge.
 * - Fill always walks sakura→sky (identity tint mixes in lightly).
 * - Low remaining still gradient, not solid butter/coral block.
 * - Soft pulse on fill only; empty track stays quiet.
 * - 0% keeps a 1-cell ghost so bar never looks broken/missing.
 */
function renderMacaronGauge(percent: number, phase: number, id: ProviderId): string {
  const p = clampPercent(percent);
  let filled = Math.round((p / 100) * GAUGE_CELLS);
  const ghost = p < 0.5; // truly empty
  if (filled === 0) filled = 1; // min visible cell for any percent incl. 0
  const identity = providerTint(id);
  const cells: string[] = [];
  for (let i = 0; i < GAUGE_CELLS; i++) {
    if (i < filled) {
      const pos = GAUGE_CELLS <= 1 ? 0 : i / (GAUGE_CELLS - 1);
      const mac = sampleMacaron(pos, phase * 0.2);
      // Blend provider identity into the macaron stop (Codex sky / Grok sakura).
      let base = mix(mac, identity, 0.35);
      if (p < 20) base = mix(base, ERROR_TINT, 0.45);
      else if (p < 50) base = mix(base, WARN_TINT, 0.25);
      if (ghost) {
        // Very soft first cell for empty quota
        base = mix(TRACK, identity, 0.4);
        cells.push(rgb(base, "░"));
      } else {
        const wave = 0.5 + 0.5 * Math.sin((i / GAUGE_CELLS + phase) * Math.PI * 2);
        const lit = mix(base, [255, 250, 252], wave * 0.18);
        cells.push(rgb(lit, "█"));
      }
    } else {
      cells.push(rgb(EMPTY, "░"));
    }
  }
  const edge = mix(identity, TRACK, 0.35);
  return `${rgb(edge, "▕")}${cells.join("")}${rgb(edge, "▏")}`;
}

function padPercent(n: number): string {
  // Fixed width "100%" / " 36%" / "  0%" so chips align.
  return `${Math.round(n)}%`.padStart(4, " ");
}

function renderProviderChip(
  id: ProviderId,
  value: ProviderState,
  phase: number,
  theme: ExtensionContext["ui"]["theme"],
): string {
  const name = providerLabel(id);
  const tint = providerTint(id);
  const label = rgb(tint, name, true);

  if (!value.snapshot) {
    const status = value.problem === "auth" ? "N/A" : value.problem === "error" ? "ERR" : "…";
    const tone = value.problem === "error" ? "warning" : "muted";
    return `${label} ${renderMacaronGauge(0, phase, id)} ${theme.fg(tone, padPercent(0).replace("0%", status.padStart(4, " ")))}`;
  }

  const percent = clampPercent(value.snapshot.remainingPercent);
  const textTint = tierTint(percent, id);
  const stale = value.stale ? "~" : "";
  const gauge = renderMacaronGauge(percent, phase, id);
  const pct = rgb(textTint, `${padPercent(percent)}${stale}`, true);
  const reset =
    value.snapshot.resetAt !== undefined
      ? formatResetLabel(value.snapshot.resetAt)
      : "";
  // Chip: Name ▕████░░▏ 36% · in 1d
  return `${label} ${gauge} ${pct}${reset}`;
}

function renderStatus(state: QuotaState, ctx: ExtensionContext): string {
  const theme = ctx.ui.theme;
  const phase = pulsePhase();
  const sep = rgb(TRACK, "  ·  ");
  return (
    renderProviderChip("codex", state.codex, phase, theme) +
    sep +
    renderProviderChip("grok", state.grok, phase, theme)
  );
}

export function renderPlainStatus(state: QuotaState): string {
  const provider = (id: ProviderId, value: ProviderState) => {
    const name = providerLabel(id);
    if (!value.snapshot) {
      const problem = value.problem === "auth" ? "n/a" : value.problem === "error" ? "error" : "loading…";
      return `${name} ▕░░░░░░▏ ${problem}`;
    }
    const percent = Math.round(clampPercent(value.snapshot.remainingPercent));
    const filled = Math.max(percent < 0.5 ? 0 : Math.round((percent / 100) * GAUGE_CELLS), 0);
    const gauge = `▕${"█".repeat(filled)}${"░".repeat(GAUGE_CELLS - filled)}▏`;
    const reset = value.snapshot.resetAt ? ` · in ${formatCountdown(value.snapshot.resetAt)}` : "";
    return `${name} ${gauge} ${padPercent(percent)}${value.stale ? "~" : ""}${reset}`;
  };
  return `${provider("codex", state.codex)}  ·  ${provider("grok", state.grok)}`;
}

/**
 * Compact remaining-time unit for footer chips.
 * SaaS pattern is "Resets in …"; we keep the unit short: 1d / 12h / 45m / 30s.
 */
export function formatCountdown(resetAt: number, now = Date.now()): string {
  const remaining = Math.max(0, resetAt - now);
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;
  if (remaining <= 0) return "now";
  if (remaining >= day) {
    const d = remaining / day;
    // Whole days when near-integer; else one decimal (1.2d).
    return Math.abs(d - Math.round(d)) < 0.05
      ? `${Math.max(1, Math.round(d))}d`
      : `${roundUpTenth(d)}d`;
  }
  if (remaining >= hour) {
    const h = remaining / hour;
    return Math.abs(h - Math.round(h)) < 0.05
      ? `${Math.max(1, Math.round(h))}h`
      : `${roundUpTenth(h)}h`;
  }
  if (remaining >= minute) return `${Math.max(1, Math.floor(remaining / minute))}m`;
  return `${Math.max(1, Math.floor(remaining / 1000))}s`;
}

/**
 * Footer reset label — modern SaaS "in …" instead of ↻ glyph.
 * Soft sky tint so it reads as secondary metadata, not alarm.
 */
function formatResetLabel(resetAt: number, now = Date.now()): string {
  const unit = formatCountdown(resetAt, now);
  // Fixed-ish: " · in " + unit. unit max ~4 chars (1.2d / 12h / now)
  const soft: RGB = [159, 190, 210]; // muted sky
  const dim: RGB = TRACK;
  return `${rgb(dim, " · ")}${rgb(soft, "in ")}${rgb(soft, unit)}`;
}

function roundUpTenth(value: number): string {
  const rounded = Math.ceil(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}


export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function withBearer(
  source: Record<string, string>,
  apiKey: string | undefined,
): Record<string, string> {
  const headers = { ...source };
  if (!hasHeader(headers, "Authorization") && apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function bearerFromHeaders(headers: Record<string, string>): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === "authorization");
  const value = entry?.[1] ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7) : undefined;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function centsValue(value: unknown): number | undefined {
  const wrapper = objectValue(value);
  return numberValue(wrapper?.val);
}

function centsPercent(config: Record<string, unknown>): number | undefined {
  const used = centsValue(config.used);
  const limit = centsValue(config.monthlyLimit);
  return used !== undefined && limit !== undefined && limit > 0
    ? (used / limit) * 100
    : undefined;
}

/**
 * Match Grok Build's billing compatibility behavior: the current credits API
 * may return a valid unified-period config while omitting both the preferred
 * percentage and the deprecated cents allowance. Grok Build treats that shape
 * as zero usage rather than a transport/schema failure.
 */
export function grokUsedPercent(config: Record<string, unknown>): number {
  return numberValue(config.creditUsagePercent) ?? centsPercent(config) ?? 0;
}

function safeUserId(value: unknown): string | undefined {
  return typeof value === "string" && /^[\x21-\x7e]{1,256}$/.test(value) ? value : undefined;
}

function resetTimestamp(window: Record<string, unknown> | undefined, now: number): number | undefined {
  if (!window) return undefined;
  for (const key of ["reset_at", "resets_at", "reset_time", "end_time", "ends_at", "expires_at"]) {
    const timestamp = timestampValue(window[key]);
    if (timestamp !== undefined) return timestamp;
  }
  const seconds = numberValue(window.reset_after_seconds);
  return seconds !== undefined && seconds >= 0 ? now + seconds * 1000 : undefined;
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return timestampValue(numeric);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
