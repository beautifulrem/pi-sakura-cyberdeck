import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { defaultConfig } from "../extensions/zentui/config";
import { PolishedEditor } from "../extensions/zentui/ui";

test("PolishedEditor frames Pi's real Editor without reading private fields", () => {
	const identity = (text: string) => text;
	const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} };
	const editorTheme = {
		borderColor: identity,
		selectList: {
			selectedPrefix: identity,
			selectedText: identity,
			description: identity,
			scrollInfo: identity,
			noMatch: identity,
		},
	};
	const uiTheme = { fg: (_c: string, t: string) => t, bold: identity } as never;
	const editor = new PolishedEditor(
		tui as never,
		editorTheme as never,
		{ matches: () => false } as never,
		uiTheme,
		() => defaultConfig,
		() => ({ modelLabel: "gpt-5", providerLabel: "OpenAI" }),
		() => "high",
	);
	editor.setText("compare gpt-5 with OpenAI\n────────");
	const lines = editor.render(50).map((line) => stripVTControlCharacters(line));
	assert.ok(lines.some((line) => line.includes("compare gpt-5 with OpenAI")), lines.join("\n"));
	assert.ok(lines.some((line) => line.includes("────────") && line.includes(defaultConfig.icons.rail)), "typed dashes stay content");
	assert.ok(lines.some((line) => /gpt-5\s+OpenAI\s+high/.test(line)));
	assert.equal(lines.length, 7, lines.join("\n"));
});
