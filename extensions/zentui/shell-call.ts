import type { ExtensionAPI, Theme, ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { highlightCode } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getColorMode } from "../shared/color";
import { sanitizeDisplayText } from "./extension-status";
import { safeThemeFg } from "./style";

type CallRenderer = NonNullable<NonNullable<ReturnType<ToolRendererResolver>>["renderCall"]>;
type CallContext = Parameters<CallRenderer>[2];

const PREVIEW_LINES = 5;
const SYNTAX_ROLES = ["toolOutput", "syntaxKeyword", "syntaxType", "syntaxNumber", "syntaxString",
	"syntaxVariable", "syntaxComment", "syntaxFunction", "syntaxOperator", "syntaxPunctuation", "text", "muted"];

/** Only the call header changes. Pi still owns execution, timers, results and truncation notices. */
class ShellCall implements Component {
	native: Component | undefined;
	private args: { command?: unknown; timeout?: unknown } = {};
	private theme!: Theme;
	private context!: CallContext;
	private language: string;
	private prompt: string;
	private enabled: () => boolean;
	private syntaxKey = "";
	private highlighted = "";
	private cache: { command: string; style: string; width: number; expanded: boolean; timeout: unknown; hint: string; lines: string[] } | undefined;

	constructor(language: string, prompt: string, enabled: () => boolean) {
		this.language = language;
		this.prompt = prompt;
		this.enabled = enabled;
	}

	update(args: unknown, theme: Theme, context: CallContext) {
		this.args = args && typeof args === "object" ? args : {};
		this.theme = theme;
		this.context = context;
	}

	invalidate() {
		this.syntaxKey = "";
		this.cache = undefined;
		this.native?.invalidate();
	}

	render(width: number): string[] {
		if (!this.enabled() || typeof this.args.command !== "string") return this.native?.render(width) ?? [];
		if (width <= 0) return [];
		const mode = getColorMode();
		const style = JSON.stringify([mode, ...SYNTAX_ROLES.map((role) => safeThemeFg(this.theme, role, "x")), safeThemeFg(this.theme, "accent", "x")]);
		const timeout = this.args.timeout;
		const rawHint = this.context.keyHint?.("app.tools.expand", "to expand") ?? "expand tool output";
		const hint = mode === "none" ? sanitizeDisplayText(rawHint) : rawHint;
		const cached = this.cache;
		if (cached && cached.command === this.args.command && cached.style === style && cached.width === width &&
			cached.expanded === this.context.expanded && cached.timeout === timeout && cached.hint === hint) return cached.lines;
		// Preserve physical lines and indentation; only remove terminal controls from display text.
		const command = this.args.command.split("\n")
			.map((line) => sanitizeDisplayText(line.replace(/\t/g, "    "))).join("\n");
		const key = JSON.stringify([command, style]);
		if (key !== this.syntaxKey) {
			// ponytail: Pi's grammar covers shell syntax; embedded heredoc/python -c grammars need an AST renderer.
			this.highlighted = mode === "none" ? command : highlightCode(command, this.language).join("\n");
			this.syntaxKey = key;
		}
		const suffix = typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
			? safeThemeFg(this.theme, "muted", ` (timeout ${timeout}s)`) : "";
		const prompt = safeThemeFg(this.theme, "accent", `${this.prompt} `);
		const text = safeThemeFg(this.theme, "toolOutput", this.highlighted || "...") + suffix;
		// Hanging indent is visual only: never insert shell operators/newlines into the actual command.
		const indent = width >= this.prompt.length + 3 ? this.prompt.length + 1 : 0;
		const rows = wrapTextWithAnsi(text, Math.max(1, width - indent));
		const shown = this.context.expanded ? rows : rows.slice(0, PREVIEW_LINES);
		const lines = shown.map((row, i) => `${i === 0 && indent ? prompt : " ".repeat(indent)}${row}`);
		if (shown.length < rows.length) {
			lines.push(truncateToWidth(safeThemeFg(this.theme, "muted", `… +${rows.length - shown.length} lines · ${hint}`), width));
		}
		const rendered = lines.map((line) => truncateToWidth(line, width, ""));
		this.cache = { command: this.args.command, style, width, expanded: this.context.expanded, timeout, hint, lines: rendered };
		return rendered;
	}
}

export function registerShellCallRenderer(pi: ExtensionAPI, enabled: () => boolean): void {
	if (typeof pi.registerToolRenderer !== "function") return;
	pi.registerToolRenderer((name, next) => {
		const original = next();
		if ((name !== "bash" && name !== "powershell") || !original?.renderCall) return original;
		return {
			...original,
			renderCall(args, theme, context) {
				const component = context.lastComponent instanceof ShellCall
					? context.lastComponent : new ShellCall(name === "bash" ? "bash" : "powershell", name === "bash" ? "❯" : "PS>", enabled);
				// The native call renderer starts Pi's timer and may maintain row-local state.
				component.native = original.renderCall!(args, theme, { ...context, lastComponent: component.native });
				component.update(args, theme, context);
				return component;
			},
		};
	});
}
