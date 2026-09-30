import type {
	ExtensionAPI,
	ExtensionContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { syncColorMode } from "../shared/color";
import {
	type AnimationsConfig,
	type ColorSourcesConfig,
	type ContextStyle,
	defaultConfig,
	type ExtensionStatusColorMode,
	type ExtensionStatusPlacement,
	type FooterSegmentsConfig,
	type GitBranchConfig,
	type IconMode,
	loadConfigWithDiagnostics,
	type PathDisplayConfig,
	type PolishedTuiConfig,
	removeLegacyFixedEditorConfig,
	type SeparatorStyle,
	saveAnimationsPatch,
	saveColorSourcesPatch,
	saveContextStylePatch,
	saveExtensionStatusColorMode,
	saveExtensionStatusPlacement,
	saveFooterFormatPatch,
	saveFooterSegmentsPatch,
	saveGitBranchPatch,
	saveIconsModePatch,
	savePathDisplayPatch,
	saveSeparatorPatch,
	saveUiFeaturesPatch,
	type UiFeaturesConfig,
} from "./config";
import { installFooter } from "./footer";
import { invalidateSessionCaches } from "./format";
import { emptyGitStatus, readGitStatus } from "./git";
import { LiveContextController } from "./live-context";
import { readPackageVersionResult } from "./package-version";
import {
	createProjectRefreshScheduler,
	type ProjectProbePlan,
	planProjectProbes,
	type ScheduleProjectRefreshOptions,
	type StopProjectRefreshInterval,
	startProjectRefreshInterval,
} from "./project-refresh";
import { applyProjectRefreshToState } from "./project-state";
import { readRuntimeInfo } from "./runtime";
import { installSelectorBorderStyle } from "./selector-border";
import { SessionLifecycle } from "./session-lifecycle";
import { FIXED_EDITOR_REMOVED_MESSAGE, registerZentuiSettingsCommand } from "./settings-command";
import { createInitialState, type FooterState, syncState } from "./state";
import { applyThinkingLabel } from "./thinking-message";
import { installToolExecutionStyle } from "./tool-execution";
import { PolishedEditor, WrappedPolishedEditor } from "./ui";
import { installUserMessageStyle } from "./user-message";

const ZENTUI_EDITOR_FACTORY = Symbol.for("pi-zentui.editor-factory");
const ZENTUI_EDITOR_BASE_FACTORY = Symbol.for("pi-zentui.editor-base-factory");

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;

type ZentuiEditorFactory = EditorFactory & {
	[ZENTUI_EDITOR_FACTORY]?: true;
	[ZENTUI_EDITOR_BASE_FACTORY]?: EditorFactory;
};

type ApplyUiResult = {
	editorBlocked: boolean;
};

type EditorInstallMode = "none" | "standalone" | "wrapper";

function isZentuiEditorFactory(factory: EditorFactory | undefined): boolean {
	return Boolean((factory as ZentuiEditorFactory | undefined)?.[ZENTUI_EDITOR_FACTORY]);
}

function getZentuiEditorBaseFactory(factory: EditorFactory | undefined): EditorFactory | undefined {
	return (factory as ZentuiEditorFactory | undefined)?.[ZENTUI_EDITOR_BASE_FACTORY];
}

/** Interactive terminal UI only (not RPC/JSON/print). Falls back to `hasUI` on hosts without `mode`. */
function isTuiContext(ctx: ExtensionContext): boolean {
	try {
		const mode = (ctx as { mode?: string }).mode;
		return ctx.hasUI && (mode === undefined || mode === "tui");
	} catch {
		return false;
	}
}

/** Probes run git / version managers inside the project; skip them when the user declined trust. */
function isProjectTrusted(ctx: ExtensionContext): boolean {
	try {
		const check = (ctx as { isProjectTrusted?: () => boolean }).isProjectTrusted;
		return typeof check === "function" ? check.call(ctx) !== false : true;
	} catch {
		return true;
	}
}

export default function (pi: ExtensionAPI) {
	const state: FooterState = createInitialState(emptyGitStatus());
	const sessionLifecycle = new SessionLifecycle();

	let currentConfig: PolishedTuiConfig = defaultConfig;
	/** Bumped on every config change; keys the probe plan below. */
	let configVersion = 0;
	let probePlan: { version: number; plan: ProjectProbePlan } | undefined;
	let activeCtx: ExtensionContext | undefined;
	let activeTheme: Theme | undefined;
	let requestFooterRender: (() => void) | undefined;
	let syncFooterAnimation: (() => void) | undefined;
	let getActiveExtensionStatuses: () => ReadonlyMap<string, string> = () => new Map();
	let stopRefreshInterval: StopProjectRefreshInterval = () => {};
	let cleanupPrototypePatches: () => void = () => {};
	let footerInstalled = false;
	let editorInstalled = false;
	let editorInstallMode: EditorInstallMode = "none";
	let installedEditorFactory: EditorFactory | undefined;
	let wrappedEditorFactory: EditorFactory | undefined;
	let prototypePatchesInstalled = false;
	let clockTimer: ReturnType<typeof setTimeout> | undefined;
	let lastProjectCwd: string | undefined;
	let agentWorking = false;
	let lastConfigProblem: string | undefined;
	let fixedEditorNoticeShown = false;

	const refresh = () => {
		if (sessionLifecycle.isCurrent()) requestFooterRender?.();
	};
	const liveContext = new LiveContextController(sessionLifecycle, refresh);
	const getActiveTheme = () => activeTheme;
	const getCurrentConfig = () => currentConfig;
	const getThinkingLevel = () =>
		sessionLifecycle.isCurrent() ? pi.getThinkingLevel() : ("off" as const);
	const getProbePlan = (): ProjectProbePlan => {
		if (probePlan?.version !== configVersion) {
			probePlan = { version: configVersion, plan: planProjectProbes(currentConfig) };
		}
		return probePlan.plan;
	};

	type ProjectRefreshTarget = { cwd: string; generation: number; trusted: boolean };
	const refreshProjectState = async ({ cwd, generation, trusted }: ProjectRefreshTarget) => {
		if (!sessionLifecycle.isCurrent(generation)) return;
		if (!trusted) {
			// Untrusted project: no subprocesses, no manifest reads; show nothing stale.
			lastProjectCwd = applyProjectRefreshToState(state, {
				cwd,
				previousCwd: lastProjectCwd,
				git: { kind: "not_a_repo" },
				runtime: { kind: "ok", runtime: undefined },
				packageVersion: { kind: "ok", result: null },
			});
			return;
		}
		const plan = getProbePlan();
		const [git, runtime, packageVersion] = await Promise.all([
			plan.git ? readGitStatus(cwd, plan.git) : undefined,
			plan.runtime ? readRuntimeInfo(cwd) : undefined,
			plan.packageVersion ? readPackageVersionResult(cwd) : undefined,
		]);
		if (!sessionLifecycle.isCurrent(generation)) return;
		lastProjectCwd = applyProjectRefreshToState(state, {
			cwd,
			previousCwd: lastProjectCwd,
			git,
			runtime,
			packageVersion,
		});
	};

	const projectRefreshScheduler = createProjectRefreshScheduler(refreshProjectState, refresh);
	const scheduleProjectRefresh = (
		ctx: ExtensionContext,
		options?: ScheduleProjectRefreshOptions,
	) => {
		const generation = sessionLifecycle.currentGeneration();
		if (!sessionLifecycle.isCurrent(generation) || !footerInstalled) return;
		const plan = getProbePlan();
		if (!plan.git && !plan.runtime && !plan.packageVersion) return;
		projectRefreshScheduler.schedule(
			{ cwd: ctx.cwd, generation, trusted: isProjectTrusted(ctx) },
			options,
		);
	};

	const refreshInteractiveState = (ctx: ExtensionContext, project = false) => {
		if (!sessionLifecycle.isCurrent() || !isTuiContext(ctx)) return;
		syncState(state, ctx);
		if (project) scheduleProjectRefresh(ctx);
		refresh();
	};

	const stopProjectRefresh = () => {
		stopRefreshInterval();
		stopRefreshInterval = () => {};
		projectRefreshScheduler.stop();
	};

	const restartProjectRefreshInterval = (ctx: ExtensionContext) => {
		stopRefreshInterval();
		stopRefreshInterval = () => {};
		const plan = getProbePlan();
		if (!footerInstalled || (!plan.git && !plan.runtime && !plan.packageVersion)) return;
		stopRefreshInterval = startProjectRefreshInterval(currentConfig.projectRefreshIntervalMs, () =>
			scheduleProjectRefresh(ctx),
		);
	};

	const stopClockTimer = () => {
		if (clockTimer) clearTimeout(clockTimer);
		clockTimer = undefined;
	};

	/**
	 * One self-rescheduling timeout, only while time/duration is visible: wakes at
	 * the next minute boundary for HH:MM, or when the duration label changes
	 * (every second below one hour, every minute after).
	 */
	const startClockTimer = () => {
		stopClockTimer();
		if (!footerInstalled || !currentConfig.features.statusLine) return;
		const { clock, duration } = getProbePlan();
		if (!clock && !duration) return;
		const schedule = () => {
			const now = Date.now();
			let delay = Number.POSITIVE_INFINITY;
			if (clock) delay = 60_000 - (now % 60_000);
			if (duration && state.sessionStartEpoch) {
				const elapsed = Math.max(0, now - state.sessionStartEpoch);
				const step = elapsed < 3_600_000 ? 1_000 : 60_000;
				delay = Math.min(delay, step - (elapsed % step));
			}
			clockTimer = setTimeout(
				() => {
					clockTimer = undefined;
					if (!sessionLifecycle.isCurrent()) return;
					refresh();
					schedule();
				},
				Math.max(50, delay + 20),
			);
			clockTimer.unref?.();
		};
		schedule();
	};

	const installPrototypePatches = (ctx: ExtensionContext) => {
		if (prototypePatchesInstalled) return;
		const cleanupSelectorBorderStyle = installSelectorBorderStyle(getActiveTheme, getCurrentConfig);
		const cleanupUserMessageStyle = installUserMessageStyle(getActiveTheme, getCurrentConfig);
		const cleanupToolExecutionStyle = installToolExecutionStyle(getActiveTheme);
		cleanupPrototypePatches = () => {
			cleanupToolExecutionStyle();
			cleanupSelectorBorderStyle();
			cleanupUserMessageStyle();
		};
		prototypePatchesInstalled = true;
		applyThinkingLabel(ctx);
	};

	const uninstallPrototypePatches = (ctx?: ExtensionContext) => {
		const wasInstalled = prototypePatchesInstalled;
		cleanupPrototypePatches();
		cleanupPrototypePatches = () => {};
		prototypePatchesInstalled = false;
		if (wasInstalled && ctx) applyThinkingLabel(ctx, false);
	};

	const editorMeta = () => ({
		modelLabel: state.modelLabel,
		providerLabel: state.providerLabel,
	});

	const makeEditorFactory = (ctx: ExtensionContext): ZentuiEditorFactory => {
		const sessionTheme = ctx.ui.theme;
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
			new PolishedEditor(
				tui,
				theme,
				keybindings,
				sessionTheme,
				getCurrentConfig,
				editorMeta,
				getThinkingLevel,
			)) as ZentuiEditorFactory;
		factory[ZENTUI_EDITOR_FACTORY] = true;
		return factory;
	};

	const makeWrappedEditorFactory = (
		ctx: ExtensionContext,
		baseFactory: EditorFactory,
	): ZentuiEditorFactory => {
		const sessionTheme = ctx.ui.theme;
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
			new WrappedPolishedEditor(
				baseFactory(tui, theme, keybindings),
				sessionTheme,
				getCurrentConfig,
				editorMeta,
				getThinkingLevel,
			)) as ZentuiEditorFactory;
		factory[ZENTUI_EDITOR_FACTORY] = true;
		factory[ZENTUI_EDITOR_BASE_FACTORY] = baseFactory;
		return factory;
	};

	const installEditor = (ctx: ExtensionContext): boolean => {
		const currentFactory = ctx.ui.getEditorComponent();
		if (currentFactory && currentFactory === installedEditorFactory) {
			editorInstalled = true;
			return true;
		}

		const currentZentuiBaseFactory = getZentuiEditorBaseFactory(currentFactory);
		let nextFactory: ZentuiEditorFactory;
		if (currentFactory && isZentuiEditorFactory(currentFactory)) {
			wrappedEditorFactory = currentZentuiBaseFactory;
			nextFactory = currentZentuiBaseFactory
				? makeWrappedEditorFactory(ctx, currentZentuiBaseFactory)
				: makeEditorFactory(ctx);
			editorInstallMode = currentZentuiBaseFactory ? "wrapper" : "standalone";
		} else if (currentFactory) {
			wrappedEditorFactory = currentFactory;
			nextFactory = makeWrappedEditorFactory(ctx, currentFactory);
			editorInstallMode = "wrapper";
		} else {
			wrappedEditorFactory = undefined;
			nextFactory = makeEditorFactory(ctx);
			editorInstallMode = "standalone";
		}
		ctx.ui.setEditorComponent(nextFactory);
		installedEditorFactory = nextFactory;
		editorInstalled = true;
		return true;
	};

	const uninstallEditor = (ctx: ExtensionContext): boolean => {
		const currentFactory = ctx.ui.getEditorComponent();
		if (currentFactory && !isZentuiEditorFactory(currentFactory)) return false;

		ctx.ui.setEditorComponent(
			editorInstallMode === "wrapper" && wrappedEditorFactory ? wrappedEditorFactory : undefined,
		);
		wrappedEditorFactory = undefined;
		installedEditorFactory = undefined;
		editorInstallMode = "none";
		editorInstalled = false;
		return true;
	};

	const installStatusLine = (ctx: ExtensionContext) => {
		if (footerInstalled) return;
		installFooter(ctx, state, getCurrentConfig, {
			setRequestRender: (fn) => {
				requestFooterRender = fn;
			},
			scheduleProjectRefresh: () => scheduleProjectRefresh(ctx),
			setExtensionStatusesGetter(fn) {
				getActiveExtensionStatuses = fn ?? (() => new Map());
			},
			getLiveContext: () => liveContext.get(),
			isAgentWorking: () => agentWorking,
			setAnimationSync: (fn) => {
				syncFooterAnimation = fn;
			},
		});
		footerInstalled = true;
		stopProjectRefresh();
		restartProjectRefreshInterval(ctx);
		// Paint the footer shell first; project probes run on the next tick.
		refresh();
		sessionLifecycle.defer(() => {
			scheduleProjectRefresh(ctx, { force: true });
			startClockTimer();
		});
	};

	const uninstallStatusLine = (ctx: ExtensionContext) => {
		stopClockTimer();
		stopProjectRefresh();
		ctx.ui.setFooter(undefined);
		footerInstalled = false;
		requestFooterRender = undefined;
		syncFooterAnimation = undefined;
		getActiveExtensionStatuses = () => new Map();
	};

	const applyConfiguredUi = (ctx: ExtensionContext): ApplyUiResult => {
		const result: ApplyUiResult = { editorBlocked: false };
		if (!isTuiContext(ctx)) return result;
		activeTheme = ctx.ui.theme;

		if (currentConfig.features.messageStyle) installPrototypePatches(ctx);
		else if (prototypePatchesInstalled) uninstallPrototypePatches(ctx);

		if (currentConfig.features.editor) {
			const currentFactory = ctx.ui.getEditorComponent();
			const editorMissingOrReplaced = !editorInstalled || !isZentuiEditorFactory(currentFactory);
			if (editorMissingOrReplaced) result.editorBlocked = !installEditor(ctx);
		} else if (editorInstalled) {
			result.editorBlocked = !uninstallEditor(ctx);
		}

		if (currentConfig.features.statusLine) {
			installStatusLine(ctx);
		} else if (footerInstalled) {
			uninstallStatusLine(ctx);
		}
		return result;
	};

	/** Adopt a new config: re-plan probes/timers/animation and repaint immediately. */
	const applyConfig = (next: PolishedTuiConfig) => {
		currentConfig = next;
		configVersion += 1;
		syncFooterAnimation?.();
		const ctx = activeCtx;
		if (ctx && footerInstalled && sessionLifecycle.isCurrent()) {
			restartProjectRefreshInterval(ctx);
			startClockTimer();
			scheduleProjectRefresh(ctx, { force: true });
		}
		refresh();
	};

	const loadConfigForSession = (ctx: ExtensionContext) => {
		const loaded = loadConfigWithDiagnostics();
		currentConfig = loaded.config;
		configVersion += 1;
		if (loaded.problem && loaded.problem !== lastConfigProblem) {
			ctx.ui.notify(
				`Zentui config is invalid, using defaults (settings changes are not saved until it is fixed): ${loaded.problem}`,
				"warning",
			);
		}
		lastConfigProblem = loaded.problem;
		if (loaded.hasLegacyFixedEditor && !fixedEditorNoticeShown) {
			fixedEditorNoticeShown = true;
			try {
				// One-time migration so the block (and any notice) is not repeated on every launch.
				currentConfig = removeLegacyFixedEditorConfig();
			} catch {
				// Read-only config: the notice still shows only once per process.
			}
			if (loaded.legacyFixedEditorEnabled) ctx.ui.notify(FIXED_EDITOR_REMOVED_MESSAGE, "info");
		}
	};

	const installUi = (ctx: ExtensionContext) => {
		if (!isTuiContext(ctx)) return;
		activeCtx = ctx;
		activeTheme = ctx.ui.theme;
		syncColorMode(ctx.ui.theme);
		uninstallPrototypePatches();
		footerInstalled = false;
		editorInstalled = false;
		installedEditorFactory = undefined;
		loadConfigForSession(ctx);
		syncState(state, ctx);
		stopProjectRefresh();
		applyConfiguredUi(ctx);
		refresh();
	};

	const scheduleEditorReconciliation = (ctx: ExtensionContext) => {
		sessionLifecycle.defer(() => {
			if (!isTuiContext(ctx) || !currentConfig.features.editor) return;
			const currentFactory = ctx.ui.getEditorComponent();
			if (currentFactory && currentFactory !== installedEditorFactory) {
				applyConfiguredUi(ctx);
				refresh();
			}
		});
	};

	/** Idempotent: the lifecycle guard makes repeated shutdowns no-ops. */
	const cleanupUi = (ctx?: ExtensionContext) => {
		if (!ctx || !sessionLifecycle.isCurrent()) return;
		sessionLifecycle.shutdown();
		agentWorking = false;
		try {
			stopClockTimer();
			stopProjectRefresh();
			uninstallPrototypePatches(isTuiContext(ctx) ? ctx : undefined);
			requestFooterRender = undefined;
			syncFooterAnimation = undefined;
			getActiveExtensionStatuses = () => new Map();
			if (isTuiContext(ctx)) {
				ctx.ui.setFooter(undefined);
				const currentFactory = ctx.ui.getEditorComponent();
				if (!currentFactory || isZentuiEditorFactory(currentFactory)) {
					ctx.ui.setEditorComponent(
						getZentuiEditorBaseFactory(currentFactory) ??
							(editorInstallMode === "wrapper" && wrappedEditorFactory
								? wrappedEditorFactory
								: undefined),
					);
				}
			}
		} finally {
			wrappedEditorFactory = undefined;
			installedEditorFactory = undefined;
			editorInstallMode = "none";
			footerInstalled = false;
			editorInstalled = false;
			activeTheme = undefined;
			activeCtx = undefined;
			requestFooterRender = undefined;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		sessionLifecycle.start();
		liveContext.clear();
		agentWorking = false;
		state.sessionStartEpoch = Date.now();
		invalidateSessionCaches();
		lastProjectCwd = undefined;
		installUi(ctx);
		scheduleEditorReconciliation(ctx);
	});

	registerZentuiSettingsCommand(pi, {
		sessionLifecycle,
		getConfig: getCurrentConfig,
		setColorSources(patch: Partial<ColorSourcesConfig>) {
			applyConfig(saveColorSourcesPatch(patch));
		},
		setUiFeatures(patch: Partial<UiFeaturesConfig>, ctx: ExtensionContext) {
			applyConfig(saveUiFeaturesPatch(patch));
			const result = applyConfiguredUi(ctx);
			return {
				applied: !(patch.editor !== undefined && result.editorBlocked),
				reason: result.editorBlocked
					? "another extension is currently managing the editor; reload Pi to apply this change"
					: undefined,
			};
		},
		setFooterSegments(patch: Partial<FooterSegmentsConfig>) {
			applyConfig(saveFooterSegmentsPatch(patch));
		},
		setFooterFormat(value: string) {
			applyConfig(saveFooterFormatPatch(value));
		},
		setIconMode(mode: IconMode) {
			applyConfig(saveIconsModePatch(mode));
		},
		setContextStyle(style: ContextStyle) {
			applyConfig(saveContextStylePatch(style));
		},
		setSeparator(separator: SeparatorStyle) {
			applyConfig(saveSeparatorPatch(separator));
		},
		setPathDisplay(patch: Partial<PathDisplayConfig>) {
			applyConfig(savePathDisplayPatch(patch));
		},
		setGitBranch(patch: Partial<GitBranchConfig>) {
			applyConfig(saveGitBranchPatch(patch));
		},
		getActiveExtensionStatuses() {
			return getActiveExtensionStatuses();
		},
		setExtensionStatusPlacement(key: string, placement: ExtensionStatusPlacement) {
			applyConfig(saveExtensionStatusPlacement(key, placement));
		},
		setExtensionStatusColorMode(key: string, colorMode: ExtensionStatusColorMode) {
			applyConfig(saveExtensionStatusColorMode(key, colorMode));
		},
		setAnimations(patch: Partial<AnimationsConfig>) {
			applyConfig(saveAnimationsPatch(patch));
		},
		requestRender() {
			refresh();
		},
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		liveContext.clear();
		cleanupUi(ctx);
	});

	const syncInteractiveState = (_event: unknown, ctx: ExtensionContext) => {
		refreshInteractiveState(ctx);
	};
	const syncInteractiveAndProjectState = (_event: unknown, ctx: ExtensionContext) => {
		refreshInteractiveState(ctx, true);
	};
	const syncAfterHistoryChange = (_event: unknown, ctx: ExtensionContext) => {
		invalidateSessionCaches();
		refreshInteractiveState(ctx, true);
	};

	pi.on("agent_start", (event, ctx) => {
		liveContext.clear();
		agentWorking = true;
		syncFooterAnimation?.();
		syncInteractiveState(event, ctx);
	});
	pi.on("agent_end", (event, ctx) => {
		liveContext.clear();
		agentWorking = false;
		syncFooterAnimation?.();
		syncInteractiveAndProjectState(event, ctx);
	});
	pi.on("model_select", (event, ctx) => {
		liveContext.clear();
		syncInteractiveState(event, ctx);
	});
	pi.on("thinking_level_select", syncInteractiveState);
	pi.on("message_update", (event) => {
		liveContext.update(event.message);
	});
	pi.on("message_end", (event, ctx) => {
		// Pi notifies extensions before persisting a successful message, so retain its live
		// context until agent_end; failed messages clear immediately instead of showing stale usage.
		if (
			event.message.role === "assistant" &&
			(event.message.stopReason === "error" || event.message.stopReason === "aborted")
		) {
			liveContext.clear();
		}
		syncAfterHistoryChange(event, ctx);
	});
	pi.on("tool_execution_start", (event, ctx) => {
		liveContext.clear();
		syncInteractiveState(event, ctx);
	});
	pi.on("tool_execution_end", syncInteractiveAndProjectState);
	pi.on("session_compact", (event, ctx) => {
		liveContext.clear();
		syncAfterHistoryChange(event, ctx);
	});
	pi.on("session_tree", (event, ctx) => {
		liveContext.clear();
		syncAfterHistoryChange(event, ctx);
	});
}
