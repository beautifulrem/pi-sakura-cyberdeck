import { homedir, hostname, userInfo } from "node:os";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
	ColorSource,
	ColorSpec,
	ContextStyle,
	ContextThresholds,
	GitBranchMaxLength,
	PathDisplayMode,
} from "./config";
import { sanitizeDisplayText } from "./extension-status";
import type { GitCommitInfo, GitMetricsInfo } from "./git";
import { type GaugeTier, renderMacaronGauge } from "./gradient";
import type { IconMode } from "./icons";
import { resolveOsIcon, resolvePackageIcon, resolveRuntimeSymbol } from "./icons";
import type { PackageVersionResult } from "./package-version";
import type { RuntimeInfo } from "./runtime";
import { renderStyleForSource } from "./style";

/**
 * Starship `git_commit` style — render a short hash, optionally with an
 * exact-match tag. See https://starship.rs/config/#git-commit
 *
 * Visibility is decided by the caller; this helper only formats the data.
 * `hashLength` is clamped to [4, 40] upstream.
 */
export function formatGitCommitSegment(
	theme: Pick<Theme, "fg">,
	commit: GitCommitInfo | undefined,
	config: { hashLength: number; onlyDetached: boolean; showTag: boolean },
	colorSource: ColorSource,
	style: ColorSpec,
): string {
	if (!commit?.oid) return "";
	// Starship's only_detached hides the whole module when attached.
	if (config.onlyDetached && !commit.detached) return "";
	const hash = commit.oid.slice(0, config.hashLength);
	const tag = config.showTag && commit.tag ? commit.tag : "";
	if (!hash && !tag) return "";
	const label = [hash, tag].filter(Boolean).join(" ");
	return renderStyleForSource(theme, colorSource, style, label);
}

/**
 * Starship `git_metrics` style — render `+added −deleted` line counts.
 * See https://starship.rs/config/#git-metrics
 *
 * When `onlyNonzero` is true, each zero component is omitted independently
 * and the whole segment hides at 0/0.
 */
export function formatGitMetricsSegment(
	theme: Pick<Theme, "fg">,
	metrics: GitMetricsInfo | null | undefined,
	config: { onlyNonzero: boolean },
	colorSource: ColorSource,
	addedStyle: ColorSpec,
	deletedStyle: ColorSpec,
): string {
	if (!metrics) return "";
	const showAdded = !config.onlyNonzero || metrics.added > 0;
	const showDeleted = !config.onlyNonzero || metrics.deleted > 0;
	if (!showAdded && !showDeleted) return "";
	const parts: string[] = [];
	if (showAdded) {
		parts.push(renderStyleForSource(theme, colorSource, addedStyle, `+${metrics.added}`));
	}
	if (showDeleted) {
		parts.push(renderStyleForSource(theme, colorSource, deletedStyle, `−${metrics.deleted}`));
	}
	return parts.join(" ");
}

export type UsageTotals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	latestCacheHitRate?: number;
	cost: number;
};

export type ContextColorTier = "normal" | "warning" | "error";

/** Structural usage shape shared by Pi 0.87 → 0.99 (every field guarded). */
type UsageLike = {
	input?: unknown;
	output?: unknown;
	cacheRead?: unknown;
	cacheWrite?: unknown;
	cost?: { total?: unknown };
};

/** Structural session entry (assistant/toolResult messages, `usage`, compaction, branch_summary). */
export type UsageSessionEntry = {
	type?: string;
	usage?: UsageLike;
	message?: { role?: string; usage?: UsageLike };
};

type SessionManagerLike = {
	getEntries(): readonly UsageSessionEntry[];
	getLeafId?(): string | null;
	getSessionId?(): string;
	/** Pi ≥ 0.99: O(1) entry count without copying the entry list. */
	getEntryCount?(): number;
};

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function formatCount(value: number): string {
	if (value < 1000) return value.toString();
	const thousandsTenths = Math.round(value / 100) / 10;
	if (thousandsTenths < 10) return `${thousandsTenths.toFixed(1)}k`;
	const thousands = Math.round(value / 1000);
	if (thousands < 1000) return `${thousands}k`;
	const millionsTenths = Math.round(value / 100_000) / 10;
	if (millionsTenths < 10) return `${millionsTenths.toFixed(1)}M`;
	return `${Math.round(value / 1_000_000)}M`;
}

export function formatProviderLabel(provider: string | undefined): string {
	if (!provider) return "Unknown";

	const known: Record<string, string> = {
		anthropic: "Anthropic",
		gemini: "Google",
		google: "Google",
		ollama: "Ollama",
		openai: "OpenAI",
		"openai-codex": "OpenAI",
	};

	return (
		known[provider] ?? provider.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
	);
}

function calculateCacheHitRate(
	input: number,
	cacheRead: number,
	cacheWrite: number,
): number | undefined {
	const promptTokens = input + cacheRead + cacheWrite;
	return promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
}

function addUsage(totals: { -readonly [K in keyof UsageTotals]: UsageTotals[K] }, usage: UsageLike) {
	totals.input += num(usage.input);
	totals.output += num(usage.output);
	totals.cacheRead += num(usage.cacheRead);
	totals.cacheWrite += num(usage.cacheWrite);
	totals.cost += num(usage.cost?.total);
}

/**
 * Session-wide usage totals, mirroring Pi's own footer (0.99.1 `FooterComponent`):
 * `usage` entries, assistant messages, tool results that carry usage, and
 * compaction / branch-summary usage. Cache-hit rate follows the latest assistant turn.
 */
export function computeUsageTotals(entries: readonly UsageSessionEntry[]): UsageTotals {
	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } as {
		-readonly [K in keyof UsageTotals]: UsageTotals[K];
	};
	for (const entry of entries) {
		if (entry.type === "usage") {
			if (entry.usage) addUsage(totals, entry.usage);
		} else if (entry.type === "message") {
			const message = entry.message;
			if (!message?.usage) continue;
			if (message.role === "assistant") {
				addUsage(totals, message.usage);
				const usage = message.usage;
				totals.latestCacheHitRate = calculateCacheHitRate(
					num(usage.input),
					num(usage.cacheRead),
					num(usage.cacheWrite),
				);
			} else if (message.role === "toolResult") {
				addUsage(totals, message.usage);
			}
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}
	return Object.freeze(totals);
}

/**
 * O(1) identity of the session state: entries are append-only and every append
 * moves the leaf (same invariant Pi's footer relies on). `undefined` = not cacheable.
 */
function sessionStateKey(sessionManager: SessionManagerLike): string | undefined {
	if (typeof sessionManager.getLeafId !== "function") return undefined;
	const count =
		typeof sessionManager.getEntryCount === "function" ? sessionManager.getEntryCount() : "";
	return `${sessionManager.getSessionId?.() ?? ""}\0${sessionManager.getLeafId() ?? ""}\0${count}`;
}

let usageTotalsCache: { key: string; totals: UsageTotals } | undefined;
let contextUsageCache: { key: string; usage: ReturnType<ExtensionContext["getContextUsage"]> } | undefined;

/** Drop cached usage/context results (call on events that may rewrite history). */
export function invalidateSessionCaches(): void {
	usageTotalsCache = undefined;
	contextUsageCache = undefined;
}

const EMPTY_TOTALS: UsageTotals = Object.freeze({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
});

export function getUsageTotals(ctx: Pick<ExtensionContext, "sessionManager">): UsageTotals {
	try {
		const sessionManager = ctx.sessionManager as unknown as SessionManagerLike;
		const key = sessionStateKey(sessionManager);
		if (key !== undefined && usageTotalsCache?.key === key) return usageTotalsCache.totals;
		const totals = computeUsageTotals(sessionManager.getEntries());
		usageTotalsCache = key === undefined ? undefined : { key, totals };
		return totals;
	} catch {
		// Stale context after a session switch: render zeros rather than crash the footer.
		return usageTotalsCache?.totals ?? EMPTY_TOTALS;
	}
}

/**
 * `ctx.getContextUsage()` scans the session (O(n)); the footer renders on every
 * TUI frame, so memoize on session state + model like Pi's own footer does.
 */
export function getCachedContextUsage(
	ctx: Pick<ExtensionContext, "sessionManager" | "model" | "getContextUsage">,
): ReturnType<ExtensionContext["getContextUsage"]> {
	try {
		const stateKey = sessionStateKey(ctx.sessionManager as unknown as SessionManagerLike);
		const model = ctx.model;
		const key =
			stateKey === undefined
				? undefined
				: `${stateKey}\0${model?.provider ?? ""}/${model?.id ?? ""}/${model?.contextWindow ?? ""}`;
		if (key !== undefined && contextUsageCache?.key === key) return contextUsageCache.usage;
		const usage = ctx.getContextUsage();
		contextUsageCache = key === undefined ? undefined : { key, usage };
		return usage;
	} catch {
		return undefined;
	}
}

export function buildTokenLabel(totals: UsageTotals, cacheHitIcon = "󰆼"): string {
	const parts: string[] = [];
	if (totals.input) parts.push(`↑${formatCount(totals.input)}`);
	if (totals.output) parts.push(`↓${formatCount(totals.output)}`);

	const hasCacheTokens = totals.cacheRead > 0 || totals.cacheWrite > 0;
	if (hasCacheTokens && totals.latestCacheHitRate !== undefined) {
		const cacheHitRate = `${totals.latestCacheHitRate.toFixed(1)}%`;
		parts.push(cacheHitIcon ? `${cacheHitIcon} ${cacheHitRate}` : cacheHitRate);
	}
	return parts.length > 0 ? parts.join(" ") : "↑0 ↓0";
}

export function buildCostLabel(totals: UsageTotals): string {
	return `$${totals.cost.toFixed(3)}`;
}

export function buildSessionDurationLabel(startEpoch: number): string {
	const totalSeconds = Math.max(0, Math.floor((Date.now() - startEpoch) / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

export function contextColorTier(
	percent: number | null | undefined,
	thresholds: ContextThresholds = { warning: 70, error: 90 },
): ContextColorTier {
	if (percent === null || percent === undefined || !Number.isFinite(percent)) return "normal";
	if (percent >= thresholds.error) return "error";
	if (percent >= thresholds.warning) return "warning";
	return "normal";
}

function buildContextGauge(
	percent: number,
	width = 10,
	ascii = false,
	phase = 0,
	tier: GaugeTier = "normal",
): string {
	if (ascii) {
		const clamped = Math.max(0, Math.min(100, percent));
		const filled = Math.round((clamped / 100) * width);
		return `${"#".repeat(filled)}${"-".repeat(Math.max(0, width - filled))}`;
	}
	// Caller wraps with [] for text+gauge / gauge styles.
	return renderMacaronGauge(percent, width, { phase, tier });
}

function formatContextPercentLabel(
	percent: number | null | undefined,
	contextWindow: number | undefined,
): string {
	if (!contextWindow || contextWindow <= 0) return "--";
	const percentLabel =
		percent === null || percent === undefined
			? "?"
			: `${Math.max(0, Math.min(999, Math.round(percent)))}%`;
	return `${percentLabel}/${formatCount(contextWindow)}`;
}

export function buildContextDisplayLabel(options: {
	percent: number | null | undefined;
	contextWindow: number | undefined;
	style?: ContextStyle;
	asciiGauge?: boolean;
	/** 0..1 pulse phase for macaron shimmer. */
	phase?: number;
	/** Align gauge palette with warning/error text tier. */
	tier?: GaugeTier;
}): string {
	const {
		percent,
		contextWindow,
		style = "text",
		asciiGauge = false,
		phase = 0,
		tier = "normal",
	} = options;
	if (!contextWindow || contextWindow <= 0) return "--";

	const text = formatContextPercentLabel(percent, contextWindow);
	const numericPercent =
		percent === null || percent === undefined || !Number.isFinite(percent)
			? 0
			: Math.max(0, Math.min(100, percent));
	const gauge = buildContextGauge(numericPercent, 10, asciiGauge, phase, tier);

	if (style === "gauge") return `[${gauge}]`;
	if (style === "text+gauge") return `[${gauge}] ${text}`;
	return text;
}

export function formatRuntimeSegment(
	theme: Pick<Theme, "fg">,
	runtime: RuntimeInfo | undefined,
	prefixStyle: ColorSpec,
	colorSource: ColorSource,
	mode: IconMode = "auto",
): string {
	if (!runtime) return "";
	const symbol = resolveRuntimeSymbol(runtime.name, runtime.symbol, mode);
	const label = runtime.version ? `${symbol} ${runtime.version}` : symbol;
	return `${renderStyleForSource(theme, colorSource, prefixStyle, "via")} ${renderStyleForSource(theme, colorSource, runtime.style, label)}`;
}

/**
 * Render the package-version segment in Starship `is <glyph> <version>` shape.
 *
 * Distinct from the runtime segment: this surfaces the project's own
 * manifest version (e.g. `package.json#version`), not the installed
 * toolchain version. Glyph comes from the Starship Nerd Font preset
 * (https://starship.rs/presets/nerd-font); default color `208` matches
 * the Starship `package` module default
 * (https://starship.rs/config/#package-version).
 */
export function formatPackageVersionSegment(
	theme: Pick<Theme, "fg">,
	pkg: PackageVersionResult | undefined,
	colorSource: ColorSource,
	mode: IconMode = "auto",
	configuredIcon: string = "",
	versionStyle: ColorSpec = "208",
): string {
	if (!pkg) return "";
	const icon = resolvePackageIcon(configuredIcon, mode);
	const label = `${icon} ${pkg.version}`;
	return `${renderStyleForSource(theme, colorSource, "", "is")} ${renderStyleForSource(theme, colorSource, versionStyle, label)}`;
}

export type FormatCwdOptions = {
	mode?: PathDisplayMode;
	/** Trailing directory components to keep in full mode. 0 = unlimited. */
	depth?: number;
	home?: string;
};

function normalizeDisplayPath(cwd: string): string {
	const withSlashes = cwd.replace(/\\/g, "/");
	if (withSlashes === "/" || /^\/+$/.test(withSlashes)) return "/";
	const stripped = withSlashes.replace(/\/+$/, "");
	return stripped === "" ? withSlashes : stripped;
}

function toHomePath(path: string, home: string): string {
	if (!home) return path;
	const homeNorm = home.replace(/\\/g, "/").replace(/\/+$/, "");
	if (!homeNorm) return path;
	if (path === homeNorm) return "~";
	if (path.startsWith(`${homeNorm}/`)) return `~${path.slice(homeNorm.length)}`;
	return path;
}

/** Starship-style: keep last `depth` components; prefix with `…/` when parents were dropped. */
function applyPathDepth(path: string, depth: number): string {
	if (!Number.isFinite(depth) || depth <= 0) return path;
	const limit = Math.floor(depth);
	if (path === "~" || path === "/") return path;

	let components: string[];
	if (path.startsWith("~/")) {
		components = path.slice(2).split("/").filter(Boolean);
	} else if (/^[A-Za-z]:\//.test(path)) {
		components = path.slice(3).split("/").filter(Boolean);
	} else if (path.startsWith("/")) {
		components = path.slice(1).split("/").filter(Boolean);
	} else {
		components = path.split("/").filter(Boolean);
	}

	if (components.length <= limit) return path;
	return `…/${components.slice(-limit).join("/")}`;
}

export function formatCwdLabel(cwd: string, cwdIcon: string, options?: FormatCwdOptions): string {
	const mode = options?.mode ?? "basename";
	const normalized = normalizeDisplayPath(sanitizeDisplayText(cwd));
	let pathText: string;
	if (mode === "full") {
		const home =
			options?.home ??
			(() => {
				try {
					return homedir();
				} catch {
					return "";
				}
			})();
		pathText = applyPathDepth(toHomePath(normalized, home), options?.depth ?? 0);
	} else if (normalized === "/") {
		pathText = "/";
	} else {
		const parts = normalized.split("/").filter(Boolean);
		pathText = parts[parts.length - 1] ?? normalized;
	}
	return cwdIcon ? `${cwdIcon} ${pathText}` : pathText;
}

function stripAnsi(text: string): string {
	return text.replace(/\u001B\[[0-9;]*m/g, "");
}

export function formatGitBranchText(
	branch: string,
	maxLength: GitBranchMaxLength = "full",
): string {
	if (maxLength === "full" || visibleWidth(branch) <= maxLength) return branch;
	return stripAnsi(truncateToWidth(branch, maxLength, "…"));
}

let userHostLabel: string | undefined;

/** `user@host`, resolved once per process (userInfo() hits the passwd database). */
export function formatUsernameHostLabel(icon: string): string {
	if (userHostLabel === undefined) {
		try {
			const user = sanitizeDisplayText(userInfo().username);
			const host = sanitizeDisplayText(hostname());
			userHostLabel = user && host ? `${user}@${host}` : "";
		} catch {
			userHostLabel = "";
		}
	}
	if (!userHostLabel) return "";
	return icon ? `${icon} ${userHostLabel}` : userHostLabel;
}

export function formatTimeLabel(icon: string): string {
	const now = new Date();
	const hours = String(now.getHours()).padStart(2, "0");
	const minutes = String(now.getMinutes()).padStart(2, "0");
	const label = `${hours}:${minutes}`;
	return icon ? `${icon} ${label}` : label;
}

export function formatOsLabel(
	configuredIcon: string,
	mode: IconMode = "auto",
	platform: string = process.platform,
): string {
	return resolveOsIcon(configuredIcon, mode, platform);
}
