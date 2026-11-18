import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters, } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { defaultConfig, mergeConfig } from "../extensions/zentui/config";
import { PolishedEditor, WrappedPolishedEditor } from "../extensions/zentui/ui";

const identity = (text: string) => text;
const uiTheme = { fg: (_c: string, t: string) => t, bold: identity, italic: identity, underline: identity } as never;
const meta = () => ({ modelLabel: "gpt-5", providerLabel: "OpenAI" });

function realEditor(config = defaultConfig) {
	const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} };
	const editorTheme = {
		borderColor: identity,
		selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity },
	};
	return new PolishedEditor(tui as never, editorTheme as never, { matches: () => false } as never, uiTheme, () => config, meta, () => "off");
}

test("framed Pi editor keeps the hidden-line count from its scroll border", () => {
	for (const config of [defaultConfig, mergeConfig({ features: { copyFriendly: true } })]) {
		const editor = realEditor(config);
		editor.setText("short");
		const baseline = editor.render(60).length;
		// 40 rows -> Pi shows max(5, 40 * 0.3) = 12 lines; the cursor sits on the last of 30.
		editor.setText(Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));
		const lines = editor.render(60);
		const plain = lines.map((line) => stripVTControlCharacters(line));
		assert.match(plain[0]!, /^─+ ↑ 18 more ─+$/, plain.join("\n"));
		assert.match(plain.at(-1)!, /^─+$/, "nothing hidden below the cursor");
		assert.equal(visibleWidth(lines[0]!), 60, "label stays inside the full-width rule");
		assert.equal(lines.length, baseline + 11, "same frame rows, only more body lines");
	}
});

function scrollingBase(top: string, bottom: string) {
	return {
		borderColor: identity as (text: string) => string,
		isShowingAutocomplete: () => false,
		render(width: number) {
			const pad = (label: string) => {
				if (!label) return "─".repeat(width);
				const text = ` ${label} `;
				const left = Math.floor((width - text.length) / 2);
				return "─".repeat(left) + text + "─".repeat(width - left - text.length);
			};
			return [this.borderColor(pad(top)), "body", this.borderColor(pad(bottom))];
		},
		invalidate() {},
		handleInput() {},
		getText: () => "body",
		setText() {},
	};
}

test("wrapped editors keep ↑/↓ scroll labels in the frame rule", () => {
	for (const [top, bottom] of [["", "↓ 4 more"], ["↑ 2 more", "↓ 7 more"]] as const) {
		const editor = new WrappedPolishedEditor(scrollingBase(top, bottom) as never, uiTheme, () => defaultConfig, meta, () => "off");
		const lines = editor.render(50);
		const plain = lines.map((line) => stripVTControlCharacters(line));
		assert.match(plain[0]!, top ? new RegExp(`^─+ ${top} ─+$`) : /^─{50}$/);
		assert.match(plain.at(-1)!, new RegExp(`^─+ ${bottom} ─+$`));
		assert.equal(visibleWidth(lines[0]!), 50);
		assert.equal(visibleWidth(lines.at(-1)!), 50);
	}
	// Unmarked rows that merely look like an indicator are body content, never a label source.
	const lookalike = scrollingBase("", "");
	lookalike.render = (width: number) => [lookalike.borderColor("─".repeat(width)), "── ↑ 9 more ──", lookalike.borderColor("─".repeat(width))];
	const plain = new WrappedPolishedEditor(lookalike as never, uiTheme, () => defaultConfig, meta, () => "off").render(50).map((line) => stripVTControlCharacters(line));
	assert.match(plain[0]!, /^─{50}$/);
	assert.match(plain.at(-1)!, /^─{50}$/);
	assert.ok(plain.some((line) => line.includes("── ↑ 9 more ──")));
});
