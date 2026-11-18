import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { getColorMode, setColorMode } from "../extensions/shared/color";
import { defaultConfig, mergeConfig, type PolishedTuiConfig } from "../extensions/zentui/config";
import { renderSakuraGradient } from "../extensions/zentui/gradient";
import { PolishedEditor, WrappedPolishedEditor } from "../extensions/zentui/ui";

// Pi 1.5.2 enters bash mode when the editor text's first non-blank character is "!"
// (interactive-mode onChange: `text.trimStart().startsWith("!")`), "!!" included, and then
// paints the editor border with `theme.getBashModeBorderColor()` (the `bashMode` token).

initTheme("dark");
const shipped = JSON.parse(readFileSync(new URL("../themes/sakura-macaron.json", import.meta.url), "utf8"));
const colors = Object.fromEntries(
	Object.entries(shipped.colors as Record<string, string>).map(([role, value]) => [role, shipped.vars[value] ?? value]),
);
const identity = (text: string) => text;
const meta = () => ({ modelLabel: "gpt-5", providerLabel: "OpenAI" });

function realEditor(theme: Theme, config: PolishedTuiConfig = defaultConfig) {
	const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} };
	const editorTheme = {
		borderColor: identity,
		selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity },
	};
	return new PolishedEditor(tui as never, editorTheme as never, { matches: () => false } as never, theme, () => config, meta, () => "off");
}

function withColorMode<T>(mode: "truecolor" | "256color" | "none", run: () => T): T {
	const previous = getColorMode();
	setColorMode(mode);
	try {
		return run();
	} finally {
		setColorMode(previous);
	}
}

const BASH_TEXTS = ["!ls", "  !ls", "!!ls", "\n!ls", "!"];
const PROMPT_TEXTS = ["ls", "x !", "", "echo !!"];

test("bash-mode text paints the editor frame rules and rail with the theme's bashMode colour", () => {
	for (const mode of ["truecolor", "256color"] as const) {
		withColorMode(mode, () => {
			const theme = new Theme(colors as never, colors as never, mode);
			const editor = realEditor(theme);
			const rule = "─".repeat(60);
			const bashRule = theme.fg("bashMode", rule);
			assert.notEqual(bashRule, renderSakuraGradient(rule), "bash colour is distinguishable");
			for (const text of BASH_TEXTS) {
				editor.setText(text);
				const lines = editor.render(60);
				assert.equal(lines[0], bashRule, `${mode} ${JSON.stringify(text)}: top rule`);
				assert.equal(lines.at(-1), bashRule, `${mode} ${JSON.stringify(text)}: bottom rule`);
				assert.ok(lines[1]!.startsWith(theme.fg("bashMode", defaultConfig.icons.rail)), `${mode} ${JSON.stringify(text)}: rail`);
				for (const line of lines) assert.equal(visibleWidth(line), 60);
			}
			for (const text of PROMPT_TEXTS) {
				editor.setText(text);
				const lines = editor.render(60);
				assert.equal(lines[0], renderSakuraGradient(rule), `${mode} ${JSON.stringify(text)}: Sakura gradient`);
				assert.equal(lines.at(-1), renderSakuraGradient(rule));
				assert.ok(!lines[1]!.includes(theme.fg("bashMode", defaultConfig.icons.rail)));
			}
			// Leaving bash mode restores the gradient at once.
			editor.setText("!git status");
			assert.equal(editor.render(60)[0], bashRule);
			editor.setText("");
			assert.equal(editor.render(60)[0], renderSakuraGradient(rule));
		});
	}
});

test("bash mode keeps the scroll label, the width and copy-friendly layout", () => {
	withColorMode("truecolor", () => {
		const theme = new Theme(colors as never, colors as never, "truecolor");
		const editor = realEditor(theme);
		editor.setText(["!for i in 1 2 3", ...Array.from({ length: 29 }, (_, i) => `echo ${i}`)].join("\n"));
		const lines = editor.render(60);
		assert.match(stripVTControlCharacters(lines[0]!), /^─+ ↑ 18 more ─+$/);
		assert.equal(lines[0], theme.fg("bashMode", stripVTControlCharacters(lines[0]!)));
		for (const line of lines) assert.equal(visibleWidth(line), 60);

		const copyFriendly = realEditor(theme, mergeConfig({ features: { copyFriendly: true } }));
		copyFriendly.setText("!ls");
		const framed = copyFriendly.render(40);
		assert.equal(framed[0], theme.fg("bashMode", "─".repeat(40)));
		assert.equal(framed.at(-1), theme.fg("bashMode", "─".repeat(40)));
	});
});

test("bash mode honours NO_COLOR and themes without a bashMode token", () => {
	withColorMode("none", () => {
		const theme = new Theme(colors as never, colors as never, "truecolor");
		const editor = realEditor(theme);
		editor.setText("!ls");
		const lines = editor.render(40);
		assert.equal(lines[0], "─".repeat(40));
		// Only the editor's own cursor / reset sequences may remain; no foreground colour.
		assert.ok(lines.every((line) => !/\x1b\[(?:3[0-9]|9[0-7])[;m]/.test(line)), JSON.stringify(lines));
	});
	withColorMode("truecolor", () => {
		// Older hosts: theme.fg throws for an unknown token -> keep the normal Sakura frame.
		const legacy = { fg: (color: string, text: string) => { if (color === "bashMode") throw new Error("unknown"); return text; }, bold: identity, italic: identity, underline: identity } as never;
		const editor = realEditor(legacy);
		editor.setText("!ls");
		assert.equal(editor.render(40)[0], renderSakuraGradient("─".repeat(40)));
	});
});

test("wrapped editors read bash mode from the wrapped editor's text", () => {
	withColorMode("truecolor", () => {
		const theme = new Theme(colors as never, colors as never, "truecolor");
		let text = "!!make";
		const base = {
			borderColor: identity as (text: string) => string,
			isShowingAutocomplete: () => false,
			render(width: number) {
				return [this.borderColor("─".repeat(width)), text, this.borderColor("─".repeat(width))];
			},
			invalidate() {},
			handleInput() {},
			getText: () => text,
			setText(next: string) { text = next; },
		};
		const editor = new WrappedPolishedEditor(base as never, theme, () => defaultConfig, meta, () => "off");
		assert.equal(editor.render(50)[0], theme.fg("bashMode", "─".repeat(50)));
		text = "make";
		assert.equal(editor.render(50)[0], renderSakuraGradient("─".repeat(50)));
	});
});
