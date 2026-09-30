import { randomUUID } from "node:crypto";
import {
	closeSync,
	fchmodSync,
	fsyncSync,
	lstatSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	ICON_GLYPH_KEYS,
	type IconGlyphs,
	type IconMode,
	normalizeIconMode,
	type ResolvedIcons,
	resolveConfiguredIcons,
} from "./icons";
import { isSupportedColorSpec } from "./style";

export type ColorSpec = string;
export type ColorSource = "theme" | "terminal";
export type { IconMode } from "./icons";

export type ContextStyle = "text" | "gauge" | "text+gauge";
export type SeparatorStyle = "pipe" | "dot" | "chevron" | "none";

export type ContextThresholds = {
	warning: number;
	error: number;
};

export type PathDisplayMode = "basename" | "full";

export type PathDisplayConfig = {
	mode: PathDisplayMode;
	/** Trailing directories to show in full mode. 0 = unlimited; clamped to 0..5. */
	depth: number;
};

export type GitBranchMaxLength = "full" | number;

export type GitBranchConfig = {
	maxLength: GitBranchMaxLength;
};

export type ColorSourcesConfig = {
	starship: ColorSource;
	editor: ColorSource;
	userMessages: ColorSource;
};

export type UiFeaturesConfig = {
	editor: boolean;
	statusLine: boolean;
	copyFriendly: boolean;
	/** Zentui styling of transcript messages, tool blocks and selector borders. */
	messageStyle: boolean;
};

export type AnimationsConfig = {
	/** Shimmer the footer gradients while the agent is working (re-renders 4×/s). */
	footerPulse: boolean;
};

export type FooterSegmentsConfig = {
	cwd: boolean;
	gitBranch: boolean;
	gitStatus: boolean;
	gitCounts: boolean;
	gitCommit: boolean;
	gitMetrics: boolean;
	runtime: boolean;
	context: boolean;
	tokens: boolean;
	cost: boolean;
	sessionDuration: boolean;
	username: boolean;
	time: boolean;
	os: boolean;
	packageVersion: boolean;
};

export type ExtensionStatusPlacement = "off" | "left" | "middle" | "right";
export type ExtensionStatusColorMode = "zentui" | "original";

/**
 * Starship `git_commit`-style options.
 * See https://starship.rs/config/#git-commit
 */
export type GitCommitConfig = {
	hashLength: number;
	onlyDetached: boolean;
	showTag: boolean;
};

/**
 * Starship `git_metrics`-style options.
 * See https://starship.rs/config/#git-metrics
 */
export type GitMetricsConfig = {
	onlyNonzero: boolean;
	ignoreSubmodules: boolean;
};

const DEFAULT_EXTENSION_STATUS_COLOR_MODE: ExtensionStatusColorMode = "zentui";

export type ExtensionStatusesConfig = {
	defaultPlacement: ExtensionStatusPlacement;
	placements: Record<string, ExtensionStatusPlacement>;
	colorModes: Record<string, ExtensionStatusColorMode>;
};

/** Background git/runtime rescan; branch switches and agent turns refresh sooner. */
const DEFAULT_PROJECT_REFRESH_INTERVAL_MS = 60_000;
const MIN_PROJECT_REFRESH_INTERVAL_MS = 5_000;

export type PolishedTuiConfig = {
	projectRefreshIntervalMs: number;
	footerFormat: string;
	separator: SeparatorStyle;
	contextStyle: ContextStyle;
	contextThresholds: ContextThresholds;
	pathDisplay: PathDisplayConfig;
	gitBranch: GitBranchConfig;
	icons: ResolvedIcons;
	colors: {
		cwd: ColorSpec;
		gitBranch: ColorSpec;
		gitStatus: ColorSpec;
		contextNormal: ColorSpec;
		contextWarning: ColorSpec;
		contextError: ColorSpec;
		tokens: ColorSpec;
		cost: ColorSpec;
		separator: ColorSpec;
		runtimePrefix: ColorSpec;
		extensionStatus: ColorSpec;
		sessionDuration: ColorSpec;
		packageVersion: ColorSpec;
		gitCommit: ColorSpec;
		gitMetricsAdded: ColorSpec;
		gitMetricsDeleted: ColorSpec;
		username: ColorSpec;
		time: ColorSpec;
		os: ColorSpec;
		editorAccent?: ColorSpec;
		editorPrompt?: ColorSpec;
		editorBorder?: ColorSpec;
		editorModel?: ColorSpec;
		editorProvider?: ColorSpec;
		editorThinking?: ColorSpec;
		editorThinkingMinimal?: ColorSpec;
		editorThinkingLow?: ColorSpec;
		editorThinkingMedium?: ColorSpec;
		editorThinkingHigh?: ColorSpec;
		editorThinkingXhigh?: ColorSpec;
		editorThinkingMax?: ColorSpec;
	};
	colorSources: ColorSourcesConfig;
	features: UiFeaturesConfig;
	animations: AnimationsConfig;
	footerSegments: FooterSegmentsConfig;
	gitCommit: GitCommitConfig;
	gitMetrics: GitMetricsConfig;
	extensionStatuses: ExtensionStatusesConfig;
};

/**
 * Alias → canonical variable name mapping for `footerFormat`.
 * `$fill` is special (not a variable) and handled by the parser.
 */
export const FOOTER_FORMAT_ALIASES: Record<string, string> = {
	directory: "cwd",
	branch: "git_branch",
	status: "git_status",
	state: "git_state",
	commit: "git_commit",
	tag: "git_tag",
	duration: "session_duration",
	separator: "sep",
};

const configPath = join(getAgentDir(), "sakura-cyberdeck-zentui.json");

// ---------------------------------------------------------------------------
// Defaults — the single source of truth. `defaultConfig` below is literally
// `mergeConfig({})`, so the parsed empty config and the exported defaults can
// never drift apart again.
// ---------------------------------------------------------------------------

const DEFAULT_COLORS: PolishedTuiConfig["colors"] = {
	cwd: "bold #F2A7C6",
	gitBranch: "bold #C7B8F5",
	gitStatus: "bold #F6BC9A",
	contextNormal: "#9FD3F2",
	contextWarning: "bold #F3D98B",
	contextError: "bold #FF8FA3",
	tokens: "#A99BAE",
	cost: "#F6BC9A",
	separator: "#877C8F",
	runtimePrefix: "#9FD3F2",
	extensionStatus: "#EFC3E6",
	sessionDuration: "#F3D98B",
	packageVersion: "#F6BC9A",
	gitCommit: "#AEE5C5",
	gitMetricsAdded: "#AEE5C5",
	gitMetricsDeleted: "#FF8FA3",
	username: "#F3D98B",
	time: "#F3D98B",
	os: "#F7EEF8",
	editorAccent: "bold #F2A7C6",
	editorPrompt: "bold #F2A7C6",
	editorBorder: "sakura-macaron-gradient",
	editorModel: "bold #F2A7C6",
	editorProvider: "#B8BEDD",
	editorThinking: "#C7B8F5",
	editorThinkingMinimal: "#877C8F",
	editorThinkingLow: "#9FD3F2",
	editorThinkingMedium: "#EFC3E6",
	editorThinkingHigh: "bold #F2A7C6",
	editorThinkingXhigh: "bold #C7B8F5",
	editorThinkingMax: "bold #FF8FA3",
};

const DEFAULT_COLOR_SOURCES: ColorSourcesConfig = {
	starship: "terminal",
	editor: "terminal",
	userMessages: "theme",
};

const DEFAULT_FEATURES: UiFeaturesConfig = {
	editor: true,
	statusLine: true,
	copyFriendly: false,
	messageStyle: true,
};

const DEFAULT_ANIMATIONS: AnimationsConfig = {
	footerPulse: false,
};

const DEFAULT_FOOTER_SEGMENTS: FooterSegmentsConfig = {
	cwd: true,
	gitBranch: true,
	gitStatus: true,
	gitCounts: false,
	runtime: true,
	context: true,
	tokens: true,
	cost: true,
	sessionDuration: false,
	username: false,
	time: false,
	os: true,
	packageVersion: false,
	gitCommit: false,
	gitMetrics: false,
};

const DEFAULT_GIT_COMMIT: GitCommitConfig = { hashLength: 7, onlyDetached: true, showTag: true };
const DEFAULT_GIT_METRICS: GitMetricsConfig = { onlyNonzero: true, ignoreSubmodules: false };
const DEFAULT_CONTEXT_THRESHOLDS: ContextThresholds = { warning: 70, error: 90 };
const DEFAULT_PATH_DISPLAY: PathDisplayConfig = { mode: "basename", depth: 0 };
const DEFAULT_GIT_BRANCH_MAX_LENGTH: GitBranchMaxLength = 30;
const DEFAULT_SEPARATOR: SeparatorStyle = "chevron";
const DEFAULT_CONTEXT_STYLE: ContextStyle = "text+gauge";
/** Empty = segment-toggle layout (a format string would override the segment toggles). */
const DEFAULT_FOOTER_FORMAT = "";
const DEFAULT_EXTENSION_PLACEMENTS: Record<string, ExtensionStatusPlacement> = {
	"codex-goal": "middle",
	"xai-usage": "right",
};

type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Prototype-free record so user-controlled keys like `__proto__` stay plain data. */
function nullProtoRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
	const record = Object.create(null) as Record<string, T>;
	for (const [key, value] of entries) record[key] = value;
	return record;
}

function parseProjectRefreshIntervalMs(value: unknown): number {
	if (value === 0) return 0;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_PROJECT_REFRESH_INTERVAL_MS;
	}

	const interval = Math.round(value);
	if (interval <= 0) return 0;
	return Math.max(MIN_PROJECT_REFRESH_INTERVAL_MS, interval);
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function parseContextStyle(value: unknown): ContextStyle {
	if (value === "text" || value === "gauge" || value === "text+gauge") return value;
	return DEFAULT_CONTEXT_STYLE;
}

export function isSeparatorStyle(value: unknown): value is SeparatorStyle {
	return value === "pipe" || value === "dot" || value === "chevron" || value === "none";
}

function parseSeparatorStyle(value: unknown): SeparatorStyle {
	return isSeparatorStyle(value) ? value : DEFAULT_SEPARATOR;
}

function parseContextThresholds(value: unknown): ContextThresholds {
	const defaults = DEFAULT_CONTEXT_THRESHOLDS;
	if (!isRecord(value)) return { ...defaults };

	const warningRaw = value.warning;
	const errorRaw = value.error;
	let warning =
		typeof warningRaw === "number" && Number.isFinite(warningRaw)
			? clampPercent(Math.round(warningRaw))
			: defaults.warning;
	let error =
		typeof errorRaw === "number" && Number.isFinite(errorRaw)
			? clampPercent(Math.round(errorRaw))
			: defaults.error;
	if (error < warning) {
		const swapped = warning;
		warning = error;
		error = swapped;
	}
	return { warning, error };
}

function parsePathDisplay(value: unknown): PathDisplayConfig {
	const defaults = DEFAULT_PATH_DISPLAY;
	if (!isRecord(value)) return { ...defaults };
	const mode = value.mode === "full" || value.mode === "basename" ? value.mode : defaults.mode;
	const rawDepth = value.depth;
	const depth =
		typeof rawDepth === "number" && Number.isFinite(rawDepth) && rawDepth >= 0
			? Math.min(5, Math.floor(rawDepth))
			: defaults.depth;
	return { mode, depth };
}

function normalizeGitBranchMaxLength(value: unknown): GitBranchMaxLength {
	if (value === "full") return value;
	if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
	return DEFAULT_GIT_BRANCH_MAX_LENGTH;
}

function parseGitBranchConfig(value: unknown): GitBranchConfig {
	if (!isRecord(value)) return { maxLength: DEFAULT_GIT_BRANCH_MAX_LENGTH };
	return {
		maxLength: normalizeGitBranchMaxLength(value.maxLength),
	};
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function colorValue(record: Record<string, unknown>, key: string): string | undefined {
	const value = stringValue(record, key);
	if (key === "editorBorder" && value === "sakura-macaron-gradient") return value;
	return value !== undefined && isSupportedColorSpec(value) ? value : undefined;
}

function colorSourceValue(
	record: Record<string, unknown>,
	key: keyof ColorSourcesConfig,
): ColorSource {
	const value = record[key];
	return value === "terminal" || value === "theme" ? value : DEFAULT_COLOR_SOURCES[key];
}

function booleanValue(record: Record<string, unknown>, key: keyof UiFeaturesConfig): boolean {
	const value = record[key];
	return typeof value === "boolean" ? value : DEFAULT_FEATURES[key];
}

function footerSegmentValue(
	record: Record<string, unknown>,
	key: keyof FooterSegmentsConfig,
): boolean {
	const value = record[key];
	return typeof value === "boolean" ? value : DEFAULT_FOOTER_SEGMENTS[key];
}

function definedColors(
	colors: Partial<Record<keyof PolishedTuiConfig["colors"], string | undefined>>,
): Partial<PolishedTuiConfig["colors"]> {
	return Object.fromEntries(
		Object.entries(colors).filter(
			(entry): entry is [keyof PolishedTuiConfig["colors"], string] => typeof entry[1] === "string",
		),
	) as Partial<PolishedTuiConfig["colors"]>;
}

function normalizeIconOverrides(record: Record<string, unknown>): Partial<IconGlyphs> {
	return Object.fromEntries(
		ICON_GLYPH_KEYS.flatMap((key) => {
			const value = stringValue(record, key);
			return value === undefined ? [] : [[key, value]];
		}),
	) as Partial<IconGlyphs>;
}

function normalizeColors(record: Record<string, unknown>): Partial<PolishedTuiConfig["colors"]> {
	return definedColors({
		cwd: colorValue(record, "cwd") ?? colorValue(record, "cwdText"),
		gitBranch: colorValue(record, "gitBranch") ?? colorValue(record, "git"),
		gitStatus: colorValue(record, "gitStatus"),
		contextNormal: colorValue(record, "contextNormal"),
		contextWarning: colorValue(record, "contextWarning"),
		contextError: colorValue(record, "contextError"),
		tokens: colorValue(record, "tokens"),
		cost: colorValue(record, "cost"),
		separator: colorValue(record, "separator"),
		runtimePrefix: colorValue(record, "runtimePrefix"),
		extensionStatus: colorValue(record, "extensionStatus"),
		sessionDuration: colorValue(record, "sessionDuration"),
		packageVersion: colorValue(record, "packageVersion"),
		gitCommit: colorValue(record, "gitCommit"),
		gitMetricsAdded: colorValue(record, "gitMetricsAdded"),
		gitMetricsDeleted: colorValue(record, "gitMetricsDeleted"),
		username: colorValue(record, "username"),
		time: colorValue(record, "time"),
		os: colorValue(record, "os"),
		editorAccent: colorValue(record, "editorAccent"),
		editorPrompt: colorValue(record, "editorPrompt"),
		editorBorder: colorValue(record, "editorBorder"),
		editorModel: colorValue(record, "editorModel"),
		editorProvider: colorValue(record, "editorProvider"),
		editorThinking: colorValue(record, "editorThinking"),
		editorThinkingMinimal: colorValue(record, "editorThinkingMinimal"),
		editorThinkingLow: colorValue(record, "editorThinkingLow"),
		editorThinkingMedium: colorValue(record, "editorThinkingMedium"),
		editorThinkingHigh: colorValue(record, "editorThinkingHigh"),
		editorThinkingXhigh: colorValue(record, "editorThinkingXhigh"),
		editorThinkingMax: colorValue(record, "editorThinkingMax"),
	});
}

function normalizeColorSources(record: Record<string, unknown>): ColorSourcesConfig {
	return {
		starship: colorSourceValue(record, "starship"),
		editor: colorSourceValue(record, "editor"),
		userMessages: colorSourceValue(record, "userMessages"),
	};
}

function normalizeUiFeatures(record: Record<string, unknown>): UiFeaturesConfig {
	return {
		editor: booleanValue(record, "editor"),
		statusLine: booleanValue(record, "statusLine"),
		copyFriendly: booleanValue(record, "copyFriendly"),
		messageStyle: booleanValue(record, "messageStyle"),
	};
}

function normalizeAnimations(value: unknown): AnimationsConfig {
	const record = isRecord(value) ? value : {};
	return {
		footerPulse:
			typeof record.footerPulse === "boolean" ? record.footerPulse : DEFAULT_ANIMATIONS.footerPulse,
	};
}

function normalizeFooterSegments(record: Record<string, unknown>): FooterSegmentsConfig {
	return {
		cwd: footerSegmentValue(record, "cwd"),
		gitBranch: footerSegmentValue(record, "gitBranch"),
		gitStatus: footerSegmentValue(record, "gitStatus"),
		gitCounts: footerSegmentValue(record, "gitCounts"),
		runtime: footerSegmentValue(record, "runtime"),
		context: footerSegmentValue(record, "context"),
		tokens: footerSegmentValue(record, "tokens"),
		cost: footerSegmentValue(record, "cost"),
		sessionDuration: footerSegmentValue(record, "sessionDuration"),
		username: footerSegmentValue(record, "username"),
		time: footerSegmentValue(record, "time"),
		os: footerSegmentValue(record, "os"),
		packageVersion: footerSegmentValue(record, "packageVersion"),
		gitCommit: footerSegmentValue(record, "gitCommit"),
		gitMetrics: footerSegmentValue(record, "gitMetrics"),
	};
}

/** Clamp hashLength to Git's valid abbreviation range [4, 40]. */
function normalizeGitHashLength(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed)) return DEFAULT_GIT_COMMIT.hashLength;
	const rounded = Math.round(parsed);
	return Math.min(40, Math.max(4, rounded));
}

function normalizeGitCommitConfig(record: Record<string, unknown>): GitCommitConfig {
	return {
		hashLength: normalizeGitHashLength(record.hashLength),
		onlyDetached:
			typeof record.onlyDetached === "boolean"
				? record.onlyDetached
				: DEFAULT_GIT_COMMIT.onlyDetached,
		showTag: typeof record.showTag === "boolean" ? record.showTag : DEFAULT_GIT_COMMIT.showTag,
	};
}

function normalizeGitMetricsConfig(record: Record<string, unknown>): GitMetricsConfig {
	return {
		onlyNonzero:
			typeof record.onlyNonzero === "boolean"
				? record.onlyNonzero
				: DEFAULT_GIT_METRICS.onlyNonzero,
		ignoreSubmodules:
			typeof record.ignoreSubmodules === "boolean"
				? record.ignoreSubmodules
				: DEFAULT_GIT_METRICS.ignoreSubmodules,
	};
}

export function isExtensionStatusPlacement(value: unknown): value is ExtensionStatusPlacement {
	return value === "off" || value === "left" || value === "middle" || value === "right";
}

export function isExtensionStatusColorMode(value: unknown): value is ExtensionStatusColorMode {
	return value === "zentui" || value === "original";
}

function normalizeExtensionStatuses(record: Record<string, unknown>): ExtensionStatusesConfig {
	const defaultPlacement = isExtensionStatusPlacement(record.defaultPlacement)
		? record.defaultPlacement
		: "right";
	const placements = nullProtoRecord(
		isRecord(record.placements)
			? Object.entries(record.placements).filter(
					(entry): entry is [string, ExtensionStatusPlacement] =>
						isExtensionStatusPlacement(entry[1]),
				)
			: [],
	);
	const colorModes = nullProtoRecord(
		isRecord(record.colorModes)
			? Object.entries(record.colorModes).filter(
					(entry): entry is [string, ExtensionStatusColorMode] =>
						isExtensionStatusColorMode(entry[1]),
				)
			: [],
	);

	return {
		defaultPlacement,
		placements,
		colorModes,
	};
}

function isColorSourceKey(value: string): value is keyof ColorSourcesConfig {
	return value === "starship" || value === "editor" || value === "userMessages";
}

function isUiFeatureKey(value: string): value is keyof UiFeaturesConfig {
	return Object.hasOwn(DEFAULT_FEATURES, value);
}

function isFooterSegmentKey(value: string): value is keyof FooterSegmentsConfig {
	return Object.hasOwn(DEFAULT_FOOTER_SEGMENTS, value);
}

function validColorSourceEntries(record: Record<string, unknown>): Partial<ColorSourcesConfig> {
	return Object.fromEntries(
		Object.entries(record).filter((entry): entry is [keyof ColorSourcesConfig, ColorSource] => {
			const [key, value] = entry;
			return isColorSourceKey(key) && (value === "theme" || value === "terminal");
		}),
	) as Partial<ColorSourcesConfig>;
}

function validUiFeatureEntries(record: Record<string, unknown>): Partial<UiFeaturesConfig> {
	return Object.fromEntries(
		Object.entries(record).filter((entry): entry is [keyof UiFeaturesConfig, boolean] => {
			const [key, value] = entry;
			return isUiFeatureKey(key) && typeof value === "boolean";
		}),
	) as Partial<UiFeaturesConfig>;
}

function validFooterSegmentEntries(record: Record<string, unknown>): Partial<FooterSegmentsConfig> {
	return Object.fromEntries(
		Object.entries(record).filter((entry): entry is [keyof FooterSegmentsConfig, boolean] => {
			const [key, value] = entry;
			return isFooterSegmentKey(key) && typeof value === "boolean";
		}),
	) as Partial<FooterSegmentsConfig>;
}

type ConfigFileState =
	| { kind: "missing"; record: ConfigRecord; writePath: string }
	| { kind: "valid"; record: ConfigRecord; writePath: string; mode: number }
	| { kind: "corrupt"; error: unknown };

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String(error.code)
		: undefined;
}

function readConfigFileState(path: string): ConfigFileState {
	let writePath = path;
	try {
		const pathStat = lstatSync(path);
		if (pathStat.isSymbolicLink()) writePath = realpathSync(path);
		const targetStat = statSync(writePath);
		const parsed = JSON.parse(readFileSync(writePath, "utf8"));
		return isRecord(parsed)
			? { kind: "valid", record: parsed, writePath, mode: targetStat.mode & 0o7777 }
			: { kind: "corrupt", error: new Error("top-level value must be a JSON object") };
	} catch (error) {
		if (errorCode(error) === "ENOENT") {
			try {
				lstatSync(path);
			} catch (pathError) {
				if (errorCode(pathError) === "ENOENT")
					return { kind: "missing", record: {}, writePath: path };
			}
		}
		return { kind: "corrupt", error };
	}
}

function writeConfigAtomically(path: string, record: ConfigRecord, mode?: number): void {
	const tempPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	let file: number | undefined;
	try {
		file = openSync(tempPath, "wx", mode ?? 0o666);
		if (mode !== undefined) fchmodSync(file, mode);
		writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
		fsyncSync(file);
		closeSync(file);
		file = undefined;
		renameSync(tempPath, path);
	} catch (error) {
		if (file !== undefined) {
			try {
				closeSync(file);
			} catch {}
		}
		try {
			unlinkSync(tempPath);
		} catch (cleanupError) {
			if (errorCode(cleanupError) !== "ENOENT") {
				// Preserve the persistence failure; the best-effort cleanup error is secondary.
			}
		}
		throw error;
	}
}

function mutateConfig(path: string, mutate: (record: ConfigRecord) => void): PolishedTuiConfig {
	const state = readConfigFileState(path);
	if (state.kind === "corrupt") {
		const detail = state.error instanceof Error ? ` (${state.error.message})` : "";
		throw new Error(
			`Refusing to save Zentui config because ${path} is corrupt or unreadable; fix or remove it first.${detail}`,
		);
	}
	mutate(state.record);
	writeConfigAtomically(
		state.writePath,
		state.record,
		state.kind === "valid" ? state.mode : undefined,
	);
	return mergeConfig(state.record);
}

export function mergeConfig(parsed: unknown): PolishedTuiConfig {
	const config = isRecord(parsed) ? parsed : {};
	const iconsRecord = isRecord(config.icons) ? config.icons : {};
	const colors = isRecord(config.colors) ? normalizeColors(config.colors) : {};
	const extensionStatuses = isRecord(config.extensionStatuses)
		? normalizeExtensionStatuses(config.extensionStatuses)
		: {
				defaultPlacement: "right" as const,
				placements: nullProtoRecord(Object.entries(DEFAULT_EXTENSION_PLACEMENTS)),
				colorModes: nullProtoRecord<ExtensionStatusColorMode>([]),
			};
	return {
		projectRefreshIntervalMs: parseProjectRefreshIntervalMs(config.projectRefreshIntervalMs),
		footerFormat: stringValue(config, "footerFormat") ?? DEFAULT_FOOTER_FORMAT,
		separator: parseSeparatorStyle(config.separator),
		contextStyle: parseContextStyle(config.contextStyle),
		contextThresholds: parseContextThresholds(config.contextThresholds),
		pathDisplay: parsePathDisplay(config.pathDisplay),
		gitBranch: parseGitBranchConfig(config.gitBranch),
		icons: resolveConfiguredIcons(
			normalizeIconMode(iconsRecord.mode),
			normalizeIconOverrides(iconsRecord),
		),
		colors: { ...DEFAULT_COLORS, ...colors },
		colorSources: isRecord(config.colorSources)
			? normalizeColorSources(config.colorSources)
			: { ...DEFAULT_COLOR_SOURCES },
		features: isRecord(config.features)
			? normalizeUiFeatures(config.features)
			: { ...DEFAULT_FEATURES },
		animations: normalizeAnimations(config.animations),
		footerSegments: isRecord(config.footerSegments)
			? normalizeFooterSegments(config.footerSegments)
			: { ...DEFAULT_FOOTER_SEGMENTS },
		gitCommit: isRecord(config.gitCommit)
			? normalizeGitCommitConfig(config.gitCommit)
			: { ...DEFAULT_GIT_COMMIT },
		gitMetrics: isRecord(config.gitMetrics)
			? normalizeGitMetricsConfig(config.gitMetrics)
			: { ...DEFAULT_GIT_METRICS },
		extensionStatuses,
	};
}

/** Built-in defaults: exactly what an empty or missing config file resolves to. */
export const defaultConfig: PolishedTuiConfig = mergeConfig({});

export function getExtensionStatusPlacement(
	config: PolishedTuiConfig,
	key: string,
): ExtensionStatusPlacement {
	const placements = config.extensionStatuses.placements;
	const placement = Object.hasOwn(placements, key) ? placements[key] : undefined;
	return isExtensionStatusPlacement(placement)
		? placement
		: config.extensionStatuses.defaultPlacement;
}

export function getExtensionStatusColorMode(
	config: PolishedTuiConfig,
	key: string,
): ExtensionStatusColorMode {
	const colorModes = config.extensionStatuses.colorModes;
	const colorMode = Object.hasOwn(colorModes, key) ? colorModes[key] : undefined;
	return isExtensionStatusColorMode(colorMode) ? colorMode : DEFAULT_EXTENSION_STATUS_COLOR_MODE;
}

export type ConfigLoadResult = {
	config: PolishedTuiConfig;
	/** Set when the file exists but cannot be read or parsed; defaults are used instead. */
	problem?: string;
	/** The file still enables the removed fixed-editor feature. */
	legacyFixedEditorEnabled: boolean;
};

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function loadConfigWithDiagnostics(path = configPath): ConfigLoadResult {
	const state = readConfigFileState(path);
	if (state.kind === "corrupt") {
		return {
			config: mergeConfig({}),
			problem: `${path}: ${describeError(state.error)}`,
			legacyFixedEditorEnabled: false,
		};
	}
	const legacy = state.record.fixedEditor;
	return {
		config: mergeConfig(state.record),
		legacyFixedEditorEnabled: isRecord(legacy) && legacy.enabled === true,
	};
}

export function loadConfig(path = configPath): PolishedTuiConfig {
	return loadConfigWithDiagnostics(path).config;
}

/** Drop the obsolete `fixedEditor` block (feature removed; Pi has native fullscreen mode). */
export function removeLegacyFixedEditorConfig(path = configPath): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		delete record.fixedEditor;
	});
}

export function saveColorSourcesPatch(
	patch: Partial<ColorSourcesConfig>,
	path = configPath,
): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const existing = isRecord(record.colorSources)
			? { ...(record.colorSources as Record<string, unknown>) }
			: {};
		record.colorSources = {
			...existing,
			...validColorSourceEntries(patch),
		};
	});
}

export function saveUiFeaturesPatch(
	patch: Partial<UiFeaturesConfig>,
	path = configPath,
): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const existing = isRecord(record.features)
			? { ...(record.features as Record<string, unknown>) }
			: {};
		record.features = {
			...existing,
			...validUiFeatureEntries(patch),
		};
	});
}

export function saveFooterSegmentsPatch(
	patch: Partial<FooterSegmentsConfig>,
	path = configPath,
): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const existing = isRecord(record.footerSegments)
			? { ...(record.footerSegments as Record<string, unknown>) }
			: {};
		record.footerSegments = {
			...existing,
			...validFooterSegmentEntries(patch),
		};
	});
}

export function saveFooterFormatPatch(value: string, path = configPath): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		record.footerFormat = typeof value === "string" ? value : "";
	});
}

export function saveIconsModePatch(mode: IconMode, path = configPath): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const existing = isRecord(record.icons) ? { ...(record.icons as Record<string, unknown>) } : {};
		record.icons = {
			...existing,
			mode: normalizeIconMode(mode),
		};
	});
}

export function saveContextStylePatch(style: ContextStyle, path = configPath): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		record.contextStyle = parseContextStyle(style);
	});
}

export function saveSeparatorPatch(
	separator: SeparatorStyle,
	path = configPath,
): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		record.separator = parseSeparatorStyle(separator);
	});
}

export function savePathDisplayPatch(
	patch: Partial<PathDisplayConfig>,
	path = configPath,
): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const existing = isRecord(record.pathDisplay)
			? { ...(record.pathDisplay as Record<string, unknown>) }
			: {};
		if (patch.mode !== undefined) existing.mode = patch.mode;
		if (patch.depth !== undefined) existing.depth = patch.depth;
		record.pathDisplay = existing;
	});
}

export function saveGitBranchPatch(
	patch: Partial<GitBranchConfig>,
	path = configPath,
): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const existing = isRecord(record.gitBranch)
			? { ...(record.gitBranch as Record<string, unknown>) }
			: {};
		if (patch.maxLength !== undefined)
			existing.maxLength = normalizeGitBranchMaxLength(patch.maxLength);
		record.gitBranch = existing;
	});
}

export function saveExtensionStatusPlacement(
	key: string,
	placement: ExtensionStatusPlacement,
	path = configPath,
): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const existingExtensionStatuses = isRecord(record.extensionStatuses)
			? { ...(record.extensionStatuses as Record<string, unknown>) }
			: {};
		const existingPlacements = isRecord(existingExtensionStatuses.placements)
			? { ...(existingExtensionStatuses.placements as Record<string, unknown>) }
			: {};

		Object.defineProperty(existingPlacements, key, {
			value: placement,
			enumerable: true,
			configurable: true,
			writable: true,
		});

		record.extensionStatuses = {
			...existingExtensionStatuses,
			placements: existingPlacements,
		};
	});
}

export function saveExtensionStatusColorMode(
	key: string,
	colorMode: ExtensionStatusColorMode,
	path = configPath,
): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const existingExtensionStatuses = isRecord(record.extensionStatuses)
			? { ...(record.extensionStatuses as Record<string, unknown>) }
			: {};
		const existingColorModes = isRecord(existingExtensionStatuses.colorModes)
			? { ...(existingExtensionStatuses.colorModes as Record<string, unknown>) }
			: {};

		Object.defineProperty(existingColorModes, key, {
			value: colorMode,
			enumerable: true,
			configurable: true,
			writable: true,
		});

		record.extensionStatuses = {
			...existingExtensionStatuses,
			colorModes: existingColorModes,
		};
	});
}

export function saveAnimationsPatch(
	patch: Partial<AnimationsConfig>,
	path = configPath,
): PolishedTuiConfig {
	return mutateConfig(path, (record) => {
		const existing = isRecord(record.animations) ? { ...record.animations } : {};
		if (typeof patch.footerPulse === "boolean") existing.footerPulse = patch.footerPulse;
		record.animations = existing;
	});
}
