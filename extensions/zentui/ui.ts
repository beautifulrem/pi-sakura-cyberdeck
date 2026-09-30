import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteProvider,
	type EditorComponent,
	type EditorTheme,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { PolishedTuiConfig } from "./config";
import { renderSakuraGradient, SAKURA_MACARON_GRADIENT } from "./gradient";
import {
	EDITOR_ACCENT_FALLBACK,
	EDITOR_BORDER_FALLBACK,
	renderStyleForSourceOrFallback,
	safeThemeFg,
} from "./style";

type WrappedEditor = EditorComponent & {
	isShowingAutocomplete?: () => boolean;
	focused?: boolean;
	onEscape?: () => void;
	onCtrlD?: () => void;
	onPasteImage?: () => void;
	onExtensionShortcut?: (data: string) => boolean;
	actionHandlers?: Map<unknown, () => void>;
	wantsKeyRelease?: boolean;
	disableSubmit?: boolean;
	getLines?: () => string[];
	getCursor?: () => unknown;
	getMode?: () => unknown;
	getPaddingX?: () => number;
	getAutocompleteMaxVisible?: () => number;
	addToHistory?: (text: string) => void;
	getExpandedText?: () => string;
	insertTextAtCursor?: (text: string) => void;
	setAutocompleteProvider?: (provider: AutocompleteProvider) => void;
	setPaddingX?: (padding: number) => void;
	setAutocompleteMaxVisible?: (maxVisible: number) => void;
};

type EditorMeta = {
	modelLabel: string;
	providerLabel: string;
};

/**
 * Temporary `borderColor` marker used while rendering the base editor: Pi's
 * Editor draws its top/bottom rules through `borderColor`, so marked lines are
 * exactly the borders and everything after the last one is the autocomplete
 * list. Marked lines are replaced by Zentui's frame and never reach the terminal.
 */
const BORDER_MARK = "\u0000zentui-border\u0000";

/**
 * Invisible tag on the model/provider line Zentui renders. Only tagged lines are
 * ever treated as stale Zentui chrome — user text is never inspected.
 */
const META_MARK = "\x1b[28m\x1b[28m";

type BorderColorHost = { borderColor?: (text: string) => string };

/** Render `host` with marked borders; returns the lines and the border indexes found. */
function renderWithMarkedBorders(
	host: BorderColorHost,
	render: () => string[],
): { lines: string[]; borders: number[] } {
	const original = host.borderColor;
	if (typeof original !== "function") return { lines: render(), borders: [] };
	let lines: string[];
	host.borderColor = (text: string) => `${BORDER_MARK}${text}`;
	try {
		lines = render();
	} finally {
		host.borderColor = original;
	}
	const borders: number[] = [];
	lines.forEach((line, index) => {
		if (line.includes(BORDER_MARK)) borders.push(index);
	});
	if (borders.length > 0) lines = lines.map((line) => line.replaceAll(BORDER_MARK, ""));
	return { lines, borders };
}

type PolishedFrameOptions = {
	width: number;
	baseRendered: string[];
	/** Indexes of the base editor's own border lines (see `renderWithMarkedBorders`). */
	borderIndexes: number[];
	isShowingAutocomplete: boolean;
	uiTheme: Theme;
	config: PolishedTuiConfig;
	modelMeta: EditorMeta;
	thinkingLevel: string | undefined;
	rightStatus?: string;
};

function clampRenderedLines(lines: string[], width: number): string[] {
	const maxWidth = Math.max(0, width);
	return lines.map((line) => truncateToWidth(line, maxWidth, ""));
}

function fillLine(content: string, width: number): string {
	const truncated = truncateToWidth(content, Math.max(0, width), "");
	const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
	return `${truncated}${pad}`;
}

function renderEditorFrameBorder(
	text: string,
	config: PolishedTuiConfig,
	uiTheme: Theme,
	colorSource: PolishedTuiConfig["colorSources"]["editor"],
): string {
	if (config.colors.editorBorder === SAKURA_MACARON_GRADIENT) {
		return renderSakuraGradient(text);
	}
	return renderStyleForSourceOrFallback(
		uiTheme,
		colorSource,
		config.colors.editorBorder,
		EDITOR_BORDER_FALLBACK,
		text,
	);
}

function editorThinkingStyle(config: PolishedTuiConfig, level: string): string | undefined {
	switch (level.toLowerCase()) {
		case "minimal":
			return config.colors.editorThinkingMinimal ?? config.colors.editorThinking;
		case "low":
			return config.colors.editorThinkingLow ?? config.colors.editorThinking;
		case "medium":
			return config.colors.editorThinkingMedium ?? config.colors.editorThinking;
		case "high":
			return config.colors.editorThinkingHigh ?? config.colors.editorThinking;
		case "xhigh":
			return config.colors.editorThinkingXhigh ?? config.colors.editorThinking;
		case "max":
			return (
				config.colors.editorThinkingMax ??
				config.colors.editorThinkingXhigh ??
				config.colors.editorThinking
			);
		default:
			return config.colors.editorThinking;
	}
}

function copyFriendlyPrompt(config: PolishedTuiConfig, uiTheme: Theme, reset: string): string {
	const promptIcon = config.icons.editorPrompt;
	return promptIcon
		? `${renderStyleForSourceOrFallback(
				uiTheme,
				config.colorSources.editor,
				config.colors.editorPrompt ?? config.colors.editorAccent,
				EDITOR_ACCENT_FALLBACK,
				promptIcon,
			)}${reset} `
		: "";
}

function getEditorChromeWidths(config: PolishedTuiConfig, uiTheme: Theme, reset: string) {
	const prompt = copyFriendlyPrompt(config, uiTheme, reset);
	const rail = config.features.copyFriendly
		? ""
		: `${renderStyleForSourceOrFallback(
				uiTheme,
				config.colorSources.editor,
				config.colors.editorAccent,
				EDITOR_ACCENT_FALLBACK,
				config.icons.rail,
			)}${reset} `;
	return {
		prompt,
		promptWidth: visibleWidth(prompt),
		rail,
		railWidth: config.features.copyFriendly ? visibleWidth(prompt) : visibleWidth(rail),
	};
}

function composeMetadataLine(left: string, right: string | undefined, width: number): string {
	if (!right) return left;
	const maxWidth = Math.max(0, width);
	const rightWidth = visibleWidth(right);
	if (rightWidth >= maxWidth) return truncateToWidth(right, maxWidth, "");

	const leftWidth = Math.max(0, maxWidth - rightWidth - 1);
	const leftText = truncateToWidth(left, leftWidth, "");
	const gap = " ".repeat(Math.max(1, maxWidth - visibleWidth(leftText) - rightWidth));
	return `${leftText}${gap}${right}`;
}

function plainRenderedText(line: string): string {
	return line
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
		.replace(/\[[/?][^\]]+\]/g, "");
}

function isHorizontalBorder(line: string): boolean {
	const plain = plainRenderedText(line).trim();
	return plain.length > 0 && /^(?:─+|─+ [↑↓] \d+ more ─*)$/.test(plain);
}

function isZentuiMetaLine(line: string): boolean {
	return line.includes(META_MARK);
}

/**
 * A wrapped base editor may itself render a Zentui frame (another extension
 * wrapping our editor). Drop only lines Zentui tagged, plus the blank spacer
 * lines directly around them.
 */
function removeZentuiMetaLines(lines: string[]): { lines: string[]; removed: boolean } {
	if (!lines.some(isZentuiMetaLine)) return { lines, removed: false };
	const result: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (isZentuiMetaLine(line)) continue;
		const blank = !plainRenderedText(line).trim();
		const nearMeta =
			isZentuiMetaLine(lines[index - 1] ?? "") || isZentuiMetaLine(lines[index + 1] ?? "");
		if (blank && nearMeta) continue;
		result.push(line);
	}
	// The stale frame also leaves its leading spacer line behind.
	if (result.length > 0 && !plainRenderedText(result[0] ?? "").trim()) result.shift();
	return { lines: result, removed: true };
}

/** Split base editor output into body and trailing autocomplete lines. */
function splitEditorRender(
	lines: string[],
	borderIndexes: number[],
	isShowingAutocomplete: boolean,
): { body: string[]; autocomplete: string[] } | undefined {
	if (borderIndexes.length >= 2) {
		const top = borderIndexes[0] ?? 0;
		const bottom = borderIndexes[borderIndexes.length - 1] ?? lines.length - 1;
		return { body: lines.slice(top + 1, bottom), autocomplete: lines.slice(bottom + 1) };
	}
	if (lines.length < 2) return undefined;
	if (isShowingAutocomplete) {
		for (let index = lines.length - 1; index >= 1; index--) {
			if (isHorizontalBorder(lines[index] ?? "")) {
				return { body: lines.slice(1, index), autocomplete: lines.slice(index + 1) };
			}
		}
	}
	return { body: lines.slice(1, -1), autocomplete: [] };
}

function vimModeColor(mode: string): string {
	switch (mode.toLowerCase()) {
		case "insert":
			return "success";
		case "normal":
			return "accent";
		case "ex":
			return "warning";
		case "replace":
			return "error";
		case "visual":
			return "syntaxKeyword";
		default:
			return "muted";
	}
}

function readVimStatus(editor: WrappedEditor, uiTheme: Theme): string | undefined {
	const mode = editor.getMode?.();
	if (typeof mode !== "string") return undefined;
	const normalized = mode.trim();
	if (!normalized) return undefined;
	const label = `${normalized.toUpperCase()} `;
	return safeThemeFg(uiTheme, vimModeColor(normalized), label);
}

function renderPolishedFrame({
	width,
	baseRendered,
	borderIndexes,
	isShowingAutocomplete,
	uiTheme,
	config,
	modelMeta,
	thinkingLevel,
	rightStatus,
}: PolishedFrameOptions): string[] {
	if (width <= 2) return clampRenderedLines(baseRendered, width);

	const reset = "\x1b[0m";
	const colorSource = config.colorSources.editor;
	const { prompt, promptWidth, rail, railWidth } = getEditorChromeWidths(config, uiTheme, reset);
	const innerWidth = Math.max(0, width - railWidth);
	const copyFriendlyContinuation = " ".repeat(promptWidth);

	const split = splitEditorRender(baseRendered, borderIndexes, isShowingAutocomplete);
	if (!split) return clampRenderedLines(baseRendered, width);
	const editorLines = removeZentuiMetaLines(split.body).lines;
	const autocompleteLines = split.autocomplete;
	const model = renderStyleForSourceOrFallback(
		uiTheme,
		colorSource,
		config.colors.editorModel,
		EDITOR_ACCENT_FALLBACK,
		modelMeta.modelLabel,
	);
	const provider = renderStyleForSourceOrFallback(
		uiTheme,
		colorSource,
		config.colors.editorProvider,
		"text",
		modelMeta.providerLabel,
	);
	const renderedModelMeta = [model, provider]
		.filter(Boolean)
		.join(safeThemeFg(uiTheme, "borderMuted", "  "));
	const metaParts = [renderedModelMeta];
	if (thinkingLevel && thinkingLevel !== "off") {
		metaParts.push(
			renderStyleForSourceOrFallback(
				uiTheme,
				colorSource,
				editorThinkingStyle(config, thinkingLevel),
				"muted",
				thinkingLevel,
			),
		);
	}
	const meta = `${META_MARK}${metaParts.filter(Boolean).join(safeThemeFg(uiTheme, "border", "  "))}`;
	const copyFriendlyMeta = composeMetadataLine(meta, rightStatus, Math.max(0, width - 1));
	const railedMeta = composeMetadataLine(meta, rightStatus, innerWidth);

	const top = renderEditorFrameBorder("─".repeat(width), config, uiTheme, colorSource);
	const bottom = renderEditorFrameBorder("─".repeat(width), config, uiTheme, colorSource);
	const lines = ["", ...editorLines, "", railedMeta];
	const renderedLines = config.features.copyFriendly
		? [
				top,
				"",
				...editorLines.map(
					(line, index) =>
						`${index === 0 ? prompt : copyFriendlyContinuation}${fillLine(line, innerWidth)}`,
				),
				"",
				` ${truncateToWidth(copyFriendlyMeta, Math.max(0, width - 1), "")}`,
				bottom,
				...autocompleteLines,
			]
		: [
				top,
				...lines.map((line) => `${rail}${fillLine(line, innerWidth)}`),
				bottom,
				...autocompleteLines,
			];

	return clampRenderedLines(renderedLines, width);
}

export class PolishedEditor extends CustomEditor {
	private readonly getModelMeta: () => EditorMeta;
	private readonly getThinkingLevel: () => string | undefined;
	private readonly getConfig: () => PolishedTuiConfig;
	private readonly uiTheme: Theme;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		uiTheme: Theme,
		getConfig: () => PolishedTuiConfig,
		getModelMeta: () => EditorMeta,
		getThinkingLevel: () => string | undefined,
	) {
		super(tui, theme, keybindings, { paddingX: 0 });
		this.borderColor = (text: string) => safeThemeFg(uiTheme, "border", text);
		this.uiTheme = uiTheme;
		this.getConfig = getConfig;
		this.getModelMeta = getModelMeta;
		this.getThinkingLevel = getThinkingLevel;
	}

	render(width: number): string[] {
		if (width <= 2) {
			return clampRenderedLines(super.render(width), width);
		}

		const config = this.getConfig();
		const { railWidth } = getEditorChromeWidths(config, this.uiTheme, "\x1b[0m");
		const innerWidth = Math.max(0, width - railWidth);
		const { lines, borders } = renderWithMarkedBorders(this, () => super.render(innerWidth));
		return renderPolishedFrame({
			width,
			baseRendered: lines,
			borderIndexes: borders,
			isShowingAutocomplete: this.isShowingAutocomplete(),
			uiTheme: this.uiTheme,
			config,
			modelMeta: this.getModelMeta(),
			thinkingLevel: this.getThinkingLevel(),
		});
	}
}

export class WrappedPolishedEditor implements EditorComponent {
	constructor(
		private readonly base: WrappedEditor,
		private readonly uiTheme: Theme,
		private readonly getConfig: () => PolishedTuiConfig,
		private readonly getModelMeta: () => EditorMeta,
		private readonly getThinkingLevel: () => string | undefined,
	) {}

	get focused(): boolean {
		return Boolean(this.base.focused);
	}
	set focused(value: boolean) {
		this.base.focused = value;
	}

	get borderColor(): ((str: string) => string) | undefined {
		return this.base.borderColor;
	}
	set borderColor(value: ((str: string) => string) | undefined) {
		this.base.borderColor = value;
	}

	get onSubmit(): ((text: string) => void) | undefined {
		return this.base.onSubmit;
	}
	set onSubmit(value: ((text: string) => void) | undefined) {
		this.base.onSubmit = value;
	}

	get onChange(): ((text: string) => void) | undefined {
		return this.base.onChange;
	}
	set onChange(value: ((text: string) => void) | undefined) {
		this.base.onChange = value;
	}

	get onEscape(): (() => void) | undefined {
		return this.base.onEscape;
	}
	set onEscape(value: (() => void) | undefined) {
		this.base.onEscape = value;
	}

	get onCtrlD(): (() => void) | undefined {
		return this.base.onCtrlD;
	}
	set onCtrlD(value: (() => void) | undefined) {
		this.base.onCtrlD = value;
	}

	get onPasteImage(): (() => void) | undefined {
		return this.base.onPasteImage;
	}
	set onPasteImage(value: (() => void) | undefined) {
		this.base.onPasteImage = value;
	}

	get onExtensionShortcut(): ((data: string) => boolean) | undefined {
		return this.base.onExtensionShortcut;
	}
	set onExtensionShortcut(value: ((data: string) => boolean) | undefined) {
		this.base.onExtensionShortcut = value;
	}

	get actionHandlers(): Map<unknown, () => void> | undefined {
		return this.base.actionHandlers;
	}
	set actionHandlers(value: Map<unknown, () => void> | undefined) {
		this.base.actionHandlers = value;
	}

	get wantsKeyRelease(): boolean | undefined {
		return this.base.wantsKeyRelease;
	}
	set wantsKeyRelease(value: boolean | undefined) {
		this.base.wantsKeyRelease = value;
	}

	get disableSubmit(): boolean | undefined {
		return this.base.disableSubmit;
	}
	set disableSubmit(value: boolean | undefined) {
		this.base.disableSubmit = value;
	}

	render(width: number): string[] {
		if (width <= 2) return clampRenderedLines(this.base.render(width), width);

		const config = this.getConfig();
		const { railWidth } = getEditorChromeWidths(config, this.uiTheme, "\x1b[0m");
		const innerWidth = Math.max(0, width - railWidth);
		const { lines, borders } = renderWithMarkedBorders(this.base, () =>
			this.base.render(innerWidth),
		);
		let showingAutocomplete = false;
		try {
			showingAutocomplete = this.base.isShowingAutocomplete?.() === true;
		} catch {}
		return renderPolishedFrame({
			width,
			baseRendered: lines,
			borderIndexes: borders,
			isShowingAutocomplete: showingAutocomplete,
			uiTheme: this.uiTheme,
			config,
			modelMeta: this.getModelMeta(),
			thinkingLevel: this.getThinkingLevel(),
			rightStatus: readVimStatus(this.base, this.uiTheme),
		});
	}

	isShowingAutocomplete(): boolean {
		return this.base.isShowingAutocomplete?.() === true;
	}

	invalidate(): void {
		this.base.invalidate?.();
	}

	handleInput(data: string): void {
		this.base.handleInput(data);
	}

	getText(): string {
		return this.base.getText();
	}

	setText(text: string): void {
		this.base.setText(text);
	}

	addToHistory(text: string): void {
		this.base.addToHistory?.(text);
	}

	insertTextAtCursor(text: string): void {
		this.base.insertTextAtCursor?.(text);
	}

	getExpandedText(): string {
		return this.base.getExpandedText?.() ?? this.base.getText();
	}

	setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.base.setAutocompleteProvider?.(provider);
	}

	setPaddingX(padding: number): void {
		this.base.setPaddingX?.(padding);
	}

	setAutocompleteMaxVisible(maxVisible: number): void {
		this.base.setAutocompleteMaxVisible?.(maxVisible);
	}

	getLines(): string[] {
		return this.base.getLines?.() ?? this.base.getText().split("\n");
	}

	getCursor(): unknown {
		return this.base.getCursor?.();
	}

	getMode(): unknown {
		return this.base.getMode?.();
	}

	getPaddingX(): number | undefined {
		return this.base.getPaddingX?.();
	}

	getAutocompleteMaxVisible(): number | undefined {
		return this.base.getAutocompleteMaxVisible?.();
	}
}
