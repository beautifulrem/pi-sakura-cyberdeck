import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PolishedTuiConfig, SeparatorStyle } from "./config";
import { FOOTER_FORMAT_ALIASES } from "./config";
import {
	collectExtensionStatusSegments,
	type ExtensionStatusSegment,
	sanitizeDisplayText,
} from "./extension-status";
import { parseFooterFormat, renderFormatSplit, stripOrphanSeparators } from "./footer-format";
import {
	buildContextDisplayLabel,
	buildCostLabel,
	buildSessionDurationLabel,
	buildTokenLabel,
	contextColorTier,
	formatCwdLabel,
	formatGitBranchText,
	formatGitCommitSegment,
	formatGitMetricsSegment,
	formatOsLabel,
	formatPackageVersionSegment,
	formatRuntimeSegment,
	formatTimeLabel,
	formatUsernameHostLabel,
	getCachedContextUsage,
	getUsageTotals,
} from "./format";
import { pulsePhase, renderSakuraGradient } from "./gradient";
import { resolveRuntimeSymbol } from "./icons";
import type { LiveContextOverride } from "./live-context";
import type { FooterState } from "./state";
import { renderStyleForSource } from "./style";

function styleContextSegment(
	theme: Parameters<typeof renderStyleForSource>[0],
	colorSource: Parameters<typeof renderStyleForSource>[1],
	contextColor: Parameters<typeof renderStyleForSource>[2],
	label: string,
	asciiGauge: boolean,
	style: string,
): string {
	if (!label || label === "--") {
		return renderStyleForSource(theme, colorSource, contextColor, label || "--");
	}
	// Truecolor gauge already carries macaron colors; only tint the trailing text / brackets.
	if (!asciiGauge && (style === "gauge" || style === "text+gauge")) {
		const split = label.match(/^(\[[\s\S]*?\])(\s*)(.*)$/);
		if (split) {
			const [, gaugePart, gap, rest] = split;
			const tintedRest = rest
				? renderStyleForSource(theme, colorSource, contextColor, rest)
				: "";
			return `${gaugePart}${gap}${tintedRest}`;
		}
	}
	return renderStyleForSource(theme, colorSource, contextColor, label);
}

const separatorText: Record<SeparatorStyle, string> = {
	pipe: " | ",
	dot: " · ",
	chevron: " › ",
	none: " ",
};

function joinStatusTexts(statusTexts: string[], separator: string): string {
	return statusTexts.filter(Boolean).join(separator);
}

function fitStatusTexts(statusTexts: string[], maxWidth: number, separator: string): string {
	if (maxWidth <= 0) return "";

	const fitted: string[] = [];
	for (const text of statusTexts) {
		const candidate = joinStatusTexts([...fitted, text], separator);
		if (visibleWidth(candidate) <= maxWidth) {
			fitted.push(text);
			continue;
		}

		if (fitted.length === 0) {
			return maxWidth > 1 ? truncateToWidth(text, maxWidth, "…") : "";
		}
		break;
	}

	return joinStatusTexts(fitted, separator);
}

function appendStatusArea(base: string, statusText: string, separator: string): string {
	if (!base) return statusText;
	if (!statusText) return base;
	return `${base}${separator}${statusText}`;
}

function prependStatusArea(base: string, statusText: string, separator: string): string {
	if (!base) return statusText;
	if (!statusText) return base;
	return `${statusText}${separator}${base}`;
}

function composeBuiltInFooterContent(left: string, right: string, innerWidth: number): string {
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	return leftWidth >= innerWidth
		? truncateToWidth(left, innerWidth, "")
		: leftWidth + 1 + rightWidth <= innerWidth
			? `${left}${" ".repeat(innerWidth - leftWidth - rightWidth)}${right}`
			: truncateToWidth(left, innerWidth, "");
}

function composeFooterContent(
	builtInLeft: string,
	builtInRight: string,
	extensionLeft: string[],
	extensionMiddle: string[],
	extensionRight: string[],
	separator: string,
	innerWidth: number,
): string {
	const builtInLeftWidth = visibleWidth(builtInLeft);
	const builtInRightWidth = visibleWidth(builtInRight);
	const minimumGap = builtInLeft && builtInRight ? 1 : 0;

	if (builtInLeftWidth + minimumGap + builtInRightWidth > innerWidth) {
		return composeBuiltInFooterContent(builtInLeft, builtInRight, innerWidth);
	}

	const available = Math.max(0, innerWidth - builtInLeftWidth - builtInRightWidth - minimumGap);
	let remaining = available;
	const leftConnectorWidth = builtInLeft && extensionLeft.length > 0 ? visibleWidth(separator) : 0;
	const rightConnectorWidth =
		builtInRight && extensionRight.length > 0 ? visibleWidth(separator) : 0;
	let leftStatus = "";
	let rightStatus = "";

	if (extensionLeft.length > 0 && extensionRight.length > 0) {
		const leftBudget = Math.max(0, Math.floor(available / 2) - leftConnectorWidth);
		leftStatus = fitStatusTexts(extensionLeft, leftBudget, separator);
		remaining -= leftStatus ? leftConnectorWidth + visibleWidth(leftStatus) : 0;

		const rightBudget = Math.max(0, remaining - rightConnectorWidth);
		rightStatus = fitStatusTexts(extensionRight, rightBudget, separator);
		remaining -= rightStatus ? rightConnectorWidth + visibleWidth(rightStatus) : 0;

		const expandedLeftBudget = Math.max(0, remaining + visibleWidth(leftStatus));
		const expandedLeftStatus = fitStatusTexts(extensionLeft, expandedLeftBudget, separator);
		if (visibleWidth(expandedLeftStatus) > visibleWidth(leftStatus)) {
			remaining += leftStatus ? leftConnectorWidth + visibleWidth(leftStatus) : 0;
			leftStatus = expandedLeftStatus;
			remaining -= leftStatus ? leftConnectorWidth + visibleWidth(leftStatus) : 0;
		}
	} else if (extensionLeft.length > 0) {
		leftStatus = fitStatusTexts(
			extensionLeft,
			Math.max(0, available - leftConnectorWidth),
			separator,
		);
		remaining -= leftStatus ? leftConnectorWidth + visibleWidth(leftStatus) : 0;
	} else if (extensionRight.length > 0) {
		rightStatus = fitStatusTexts(
			extensionRight,
			Math.max(0, available - rightConnectorWidth),
			separator,
		);
		remaining -= rightStatus ? rightConnectorWidth + visibleWidth(rightStatus) : 0;
	}

	const left = appendStatusArea(builtInLeft, leftStatus, separator);
	const right = prependStatusArea(builtInRight, rightStatus, separator);
	const gapWidth = Math.max(0, innerWidth - visibleWidth(left) - visibleWidth(right));
	const middle = fitStatusTexts(extensionMiddle, gapWidth, separator);
	const middleWidth = visibleWidth(middle);

	if (!middle || middleWidth <= 0) {
		return `${left}${" ".repeat(gapWidth)}${right}`;
	}

	const leftPadding = Math.floor((gapWidth - middleWidth) / 2);
	const rightPadding = gapWidth - middleWidth - leftPadding;
	return `${left}${" ".repeat(leftPadding)}${middle}${" ".repeat(rightPadding)}${right}`;
}

export type FooterHooks = {
	setRequestRender: (fn: (() => void) | undefined) => void;
	scheduleProjectRefresh: () => void;
	setExtensionStatusesGetter?: (fn: (() => ReadonlyMap<string, string>) | undefined) => void;
	getLiveContext?: () => LiveContextOverride | undefined;
	/** True between agent_start and agent_end. */
	isAgentWorking: () => boolean;
	/** Receives a callback that re-evaluates the pulse timer (config change / agent state). */
	setAnimationSync: (fn: (() => void) | undefined) => void;
};

const FORMAT_GRADIENT_VARS = /\$\{?(?:context|cwd|os)\b/;

/**
 * The pulse re-renders the whole TUI 4×/s, so it is opt-in
 * (`animations.footerPulse`) and only runs while the agent is working and
 * something on screen is actually phase-tinted.
 */
export function footerWantsPulse(config: PolishedTuiConfig): boolean {
	if (!config.animations.footerPulse || config.icons.mode === "ascii") return false;
	if (config.footerFormat) return FORMAT_GRADIENT_VARS.test(config.footerFormat);
	const segments = config.footerSegments;
	return (segments.context && config.contextStyle !== "text") || segments.cwd || segments.os;
}

export function installFooter(
	ctx: ExtensionContext,
	state: FooterState,
	getConfig: () => PolishedTuiConfig,
	hooks: FooterHooks,
): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		hooks.setRequestRender(() => tui.requestRender());
		hooks.setExtensionStatusesGetter?.(() => footerData.getExtensionStatuses());
		const unsubscribeBranch = footerData.onBranchChange(() => {
			hooks.scheduleProjectRefresh();
			tui.requestRender();
		});

		let pulseTimer: ReturnType<typeof setInterval> | undefined;
		const syncPulse = () => {
			const wanted = footerWantsPulse(getConfig()) && hooks.isAgentWorking();
			if (wanted && !pulseTimer) {
				pulseTimer = setInterval(() => tui.requestRender(), 250);
				pulseTimer.unref?.();
			} else if (!wanted && pulseTimer) {
				clearInterval(pulseTimer);
				pulseTimer = undefined;
				tui.requestRender(); // settle on the static (cached) frame
			}
		};
		hooks.setAnimationSync(syncPulse);
		syncPulse();

		return {
			dispose: () => {
				if (pulseTimer) clearInterval(pulseTimer);
				pulseTimer = undefined;
				unsubscribeBranch();
				hooks.setRequestRender(undefined);
				hooks.setExtensionStatusesGetter?.(undefined);
				hooks.setAnimationSync(undefined);
			},
			invalidate() {},
			render(width: number): string[] {
				if (width <= 0) return [""];
				try {
					return [renderFooterLine(width)];
				} catch {
					// A stale context after a session switch must never take the TUI down.
					return [""];
				}
			},
		};

		function renderFooterLine(width: number): string {
			const config = getConfig();
			const colorSource = config.colorSources.starship;
			const iconMode = config.icons.mode;
			const phase = pulseTimer ? pulsePhase() : 0;
			const separatorRaw = separatorText[config.separator];
			const separator =
				config.separator === "none"
					? separatorRaw
					: renderSakuraGradient(separatorRaw, phase * 0.5);
			const innerWidth = Math.max(1, width - 2);
			const cwdPlain = formatCwdLabel(ctx.cwd, config.icons.cwd, {
				mode: config.pathDisplay.mode,
				depth: config.pathDisplay.depth,
			});
			const cwdLabel =
				iconMode === "ascii"
					? renderStyleForSource(theme, colorSource, config.colors.cwd, cwdPlain)
					: renderSakuraGradient(cwdPlain, phase * 0.25);
			// Pi's footer data provider watches .git/HEAD itself; prefer it over our last scan.
			const liveBranch = footerData.getGitBranch();
			const detachedHead =
				liveBranch === "detached" || (!liveBranch && Boolean(state.commit?.detached));
			const branch =
				liveBranch && liveBranch !== "detached"
					? sanitizeDisplayText(liveBranch)
					: detachedHead
						? undefined
						: state.branch;
			const branchText = branch
				? formatGitBranchText(branch, config.gitBranch.maxLength)
				: undefined;
			let contextCache: string | undefined;
			const contextSegment = () => {
				if (contextCache !== undefined) return contextCache;
				const contextUsage = getCachedContextUsage(ctx);
				const liveContext = hooks.getLiveContext?.();
				const contextWindow = ctx.model?.contextWindow ?? contextUsage?.contextWindow;
				const useLiveContext =
					liveContext !== undefined && contextWindow !== undefined && contextWindow > 0;
				const contextPercent = useLiveContext
					? (liveContext.tokens / contextWindow) * 100
					: contextUsage?.percent;
				const tier = contextColorTier(contextPercent, config.contextThresholds);
				const label = buildContextDisplayLabel({
					percent: contextPercent,
					contextWindow,
					style: config.contextStyle,
					asciiGauge: iconMode === "ascii",
					phase,
					tier,
				});
				const color =
					tier === "error"
						? config.colors.contextError
						: tier === "warning"
							? config.colors.contextWarning
							: config.colors.contextNormal;
				contextCache = styleContextSegment(
					theme,
					colorSource,
					color,
					label,
					iconMode === "ascii",
					config.contextStyle,
				);
				return contextCache;
			};
			let totalsCache: ReturnType<typeof getUsageTotals> | undefined;
			const totals = () => {
				totalsCache ??= getUsageTotals(ctx);
				return totalsCache;
			};
			const tokensSegment = () =>
				renderStyleForSource(
					theme,
					colorSource,
					config.colors.tokens,
					buildTokenLabel(totals(), config.icons.cacheHit),
				);
			const costSegment = () =>
				renderStyleForSource(theme, colorSource, config.colors.cost, buildCostLabel(totals()));
			const gitColor = (text: string) =>
				renderStyleForSource(theme, colorSource, config.colors.gitBranch, text);
			const gitStatusColor = (text: string) =>
				renderStyleForSource(theme, colorSource, config.colors.gitStatus, text);
			const gitIcon = config.icons.git ? gitColor(config.icons.git) : "";
			const gitCounts = config.footerSegments.gitCounts;
			const stashLabel =
				state.stashed > 0
					? gitCounts
						? `${config.icons.stashed}${state.stashed}`
						: config.icons.stashed
					: "";
			const allStatus = [
				state.conflicted > 0 ? config.icons.conflicted : "",
				stashLabel,
				state.deleted > 0 ? config.icons.deleted : "",
				state.renamed > 0 ? config.icons.renamed : "",
				state.modified > 0 ? config.icons.modified : "",
				state.typechanged > 0 ? config.icons.typechanged : "",
				state.staged > 0 ? config.icons.staged : "",
				state.untracked > 0 ? config.icons.untracked : "",
			].join("");
			const aheadBehind = (() => {
				if (state.ahead > 0 && state.behind > 0) {
					return gitCounts
						? `${config.icons.ahead}${state.ahead}${config.icons.behind}${state.behind}`
						: config.icons.diverged;
				}
				if (state.ahead > 0)
					return gitCounts ? `${config.icons.ahead}${state.ahead}` : config.icons.ahead;
				if (state.behind > 0)
					return gitCounts ? `${config.icons.behind}${state.behind}` : config.icons.behind;
				return "";
			})();
			const statusBlock = state.gitUnavailable
				? gitStatusColor("[git n/a]")
				: allStatus || aheadBehind
					? gitStatusColor(`[${allStatus}${aheadBehind}]`)
					: "";
			const gitStateLabel = state.gitStateLabel ?? "";
			const gitStateBlock = gitStateLabel ? gitStatusColor(gitStateLabel) : "";
			const renderVariable = (name: string): string => {
				const canonical = FOOTER_FORMAT_ALIASES[name] ?? name;
				switch (canonical) {
					case "cwd":
						return cwdLabel;
					case "git_branch":
						return branchText
							? gitIcon
								? `${gitIcon} ${gitColor(branchText)}`
								: gitColor(branchText)
							: "";
					case "git_status":
						return statusBlock;
					case "git_state":
						return gitStateBlock;
					case "runtime": {
						if (!state.runtime) return "";
						const symbol = resolveRuntimeSymbol(
							state.runtime.name,
							state.runtime.symbol,
							iconMode,
						);
						const label = state.runtime.version ? `${symbol} ${state.runtime.version}` : symbol;
						return renderStyleForSource(theme, colorSource, state.runtime.style, label);
					}
					case "session_duration":
						return state.sessionStartEpoch
							? renderStyleForSource(
									theme,
									colorSource,
									config.colors.sessionDuration,
									buildSessionDurationLabel(state.sessionStartEpoch),
								)
							: "";
					case "username":
						return renderStyleForSource(
							theme,
							colorSource,
							config.colors.username,
							formatUsernameHostLabel(config.icons.username),
						);
					case "os":
						return iconMode === "ascii"
							? renderStyleForSource(
									theme,
									colorSource,
									config.colors.os,
									formatOsLabel(config.icons.os, iconMode),
								)
							: renderSakuraGradient(
									formatOsLabel(config.icons.os, iconMode),
									(phase + 0.4) % 1,
								);
					case "time":
						return renderStyleForSource(
							theme,
							colorSource,
							config.colors.time,
							formatTimeLabel(config.icons.time),
						);
					case "context":
						return contextSegment();
					case "tokens":
						return tokensSegment();
					case "cost":
						return costSegment();
					case "package":
						return formatPackageVersionSegment(
							theme,
							state.packageVersion,
							colorSource,
							iconMode,
							config.icons.package,
							config.colors.packageVersion,
						);
					case "package_version":
						return state.packageVersion?.version
							? renderStyleForSource(
									theme,
									colorSource,
									config.colors.packageVersion,
									state.packageVersion.version,
								)
							: "";
					case "sep":
						return renderStyleForSource(
							theme,
							colorSource,
							config.colors.separator,
							separatorText[config.separator],
						);
					case "git_commit":
						return formatGitCommitSegment(
							theme,
							state.commit,
							config.gitCommit,
							colorSource,
							config.colors.gitCommit,
						);
					case "git_tag":
						return config.gitCommit.showTag && state.commit?.tag
							? renderStyleForSource(
									theme,
									colorSource,
									config.colors.gitCommit,
									state.commit.tag,
								)
							: "";
					case "git_metrics":
						return formatGitMetricsSegment(
							theme,
							state.metrics,
							config.gitMetrics,
							colorSource,
							config.colors.gitMetricsAdded,
							config.colors.gitMetricsDeleted,
						);
					case "git_added":
						return state.metrics
							? renderStyleForSource(
									theme,
									colorSource,
									config.colors.gitMetricsAdded,
									`+${state.metrics.added}`,
								)
							: "";
					case "git_deleted":
						return state.metrics
							? renderStyleForSource(
									theme,
									colorSource,
									config.colors.gitMetricsDeleted,
									`−${state.metrics.deleted}`,
								)
							: "";
					default:
						return "";
				}
			};
			const branchParts: string[] = [];
			if (config.footerSegments.gitBranch) {
				if (branchText) {
					branchParts.push("on", gitIcon, gitColor(branchText));
				} else if (detachedHead) {
					// `HEAD` uses git-branch style; `(hash)` uses git-commit style
					// (bold green) per Starship `git_commit` format.
					branchParts.push("on", gitIcon, gitColor("HEAD"));
					if (config.footerSegments.gitCommit && state.commit?.oid) {
						const shortHash = state.commit.oid.slice(0, config.gitCommit.hashLength);
						const tag = config.gitCommit.showTag && state.commit.tag ? state.commit.tag : "";
						const inner = [shortHash, tag].filter(Boolean).join(" ");
						branchParts.push(
							renderStyleForSource(theme, colorSource, config.colors.gitCommit, `(${inner})`),
						);
					}
				}
			}
			const gitStatusParts = config.footerSegments.gitStatus && statusBlock ? [statusBlock] : [];
			const showGitState = config.footerSegments.gitBranch || config.footerSegments.gitStatus;
			const gitStateParts = showGitState && gitStateBlock ? [gitStateBlock] : [];
			const branchLabel = [...branchParts, ...gitStatusParts, ...gitStateParts]
				.filter(Boolean)
				.join(" ");
			const runtimeLabel = config.footerSegments.runtime
				? formatRuntimeSegment(
						theme,
						state.runtime,
						config.colors.runtimePrefix,
						colorSource,
						iconMode,
					)
				: "";
			const packageVersionLabel = config.footerSegments.packageVersion
				? formatPackageVersionSegment(
						theme,
						state.packageVersion,
						colorSource,
						iconMode,
						config.icons.package,
						config.colors.packageVersion,
					)
				: "";
			// Skip standalone gitCommit when hash is already folded into the
			// branch display on detached HEAD.
			const hashFoldedIntoBranch = detachedHead && config.footerSegments.gitBranch;
			const gitCommitLabel =
				config.footerSegments.gitCommit && !hashFoldedIntoBranch
					? formatGitCommitSegment(
							theme,
							state.commit,
							config.gitCommit,
							colorSource,
							config.colors.gitCommit,
						)
					: "";
			const gitMetricsLabel = config.footerSegments.gitMetrics
				? formatGitMetricsSegment(
						theme,
						state.metrics,
						config.gitMetrics,
						colorSource,
						config.colors.gitMetricsAdded,
						config.colors.gitMetricsDeleted,
					)
				: "";

			const sessionDurationSegment = (() => {
				if (!config.footerSegments.sessionDuration || !state.sessionStartEpoch) return "";
				const timeLabel = buildSessionDurationLabel(state.sessionStartEpoch);
				const prefix = renderStyleForSource(theme, colorSource, "", "up for");
				const time = renderStyleForSource(
					theme,
					colorSource,
					config.colors.sessionDuration,
					timeLabel,
				);
				return `${prefix} ${time}`;
			})();
			const usernameSegment = config.footerSegments.username
				? renderStyleForSource(
						theme,
						colorSource,
						config.colors.username,
						formatUsernameHostLabel(config.icons.username),
					)
				: "";
			const osPlain = formatOsLabel(config.icons.os, iconMode);
			const osSegment = config.footerSegments.os
				? iconMode === "ascii"
					? renderStyleForSource(theme, colorSource, config.colors.os, osPlain)
					: renderSakuraGradient(osPlain, (phase + 0.4) % 1)
				: "";
			const left = [
				osSegment,
				usernameSegment,
				config.footerSegments.cwd ? cwdLabel : "",
				branchLabel,
				gitCommitLabel,
				gitMetricsLabel,
				packageVersionLabel,
				runtimeLabel,
				sessionDurationSegment,
			]
				.filter(Boolean)
				.join(" ");

			const timeSegment = config.footerSegments.time
				? renderStyleForSource(
						theme,
						colorSource,
						config.colors.time,
						formatTimeLabel(config.icons.time),
					)
				: "";
			const right = [
				config.footerSegments.context ? contextSegment() : "",
				config.footerSegments.tokens ? tokensSegment() : "",
				config.footerSegments.cost ? costSegment() : "",
				timeSegment,
			]
				.filter(Boolean)
				.join(separator);

			let contentLeft = left;
			let contentMiddle = "";
			let contentRight = right;
			if (config.footerFormat) {
				const {
					left: fmtLeft,
					middle: fmtMiddle,
					right: fmtRight,
				} = renderFormatSplit(parseFooterFormat(config.footerFormat), renderVariable);
				const glyph = separatorRaw.trim();
				contentLeft = stripOrphanSeparators(fmtLeft, glyph);
				contentMiddle = stripOrphanSeparators(fmtMiddle, glyph);
				contentRight = stripOrphanSeparators(fmtRight, glyph);
			}

			const extensionStatuses = collectExtensionStatusSegments(
				footerData.getExtensionStatuses(),
				config,
			);
			const renderExtensionStatus = (segment: ExtensionStatusSegment) =>
				segment.colorMode === "original"
					? segment.text
					: renderStyleForSource(theme, colorSource, config.colors.extensionStatus, segment.text);
			const extensionMiddleSegments = extensionStatuses.middle.map(renderExtensionStatus);
			const middleSegments = contentMiddle
				? [contentMiddle, ...extensionMiddleSegments]
				: extensionMiddleSegments;
			const content = composeFooterContent(
				contentLeft,
				contentRight,
				extensionStatuses.left.map(renderExtensionStatus),
				middleSegments,
				extensionStatuses.right.map(renderExtensionStatus),
				separator,
				innerWidth,
			);
			const body = width > 2 ? ` ${truncateToWidth(content, width - 2, "")} ` : content;
			return truncateToWidth(body, width, "");
		}
	});
}
