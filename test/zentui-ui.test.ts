import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { defaultConfig, mergeConfig } from "../extensions/zentui/config";
import { WrappedPolishedEditor } from "../extensions/zentui/ui";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
} as never;

/** Minimal Pi-Editor-like base: borders drawn through `borderColor`, autocomplete after the bottom rule. */
function fakeBase(body: string[], autocomplete: string[] = []) {
	return {
		borderColor: (text: string) => text,
		isShowingAutocomplete: () => autocomplete.length > 0,
		render(width: number) {
			const rule = this.borderColor("─".repeat(width));
			return [rule, ...body, rule, ...autocomplete];
		},
		invalidate() {},
		handleInput() {},
		getText: () => body.join("\n"),
		setText() {},
	};
}

function renderPlain(base: ReturnType<typeof fakeBase>, config = defaultConfig, thinking = "off") {
	const editor = new WrappedPolishedEditor(
		base as never,
		theme,
		() => config,
		() => ({ modelLabel: "gpt-5", providerLabel: "OpenAI" }),
		() => thinking,
	);
	return editor.render(60).map((line) => stripVTControlCharacters(line));
}

test("user text mentioning the model and provider is never stripped", () => {
	const lines = renderPlain(fakeBase(["compare gpt-5 with OpenAI", "second line"]));
	assert.ok(lines.some((line) => line.includes("compare gpt-5 with OpenAI")));
	assert.ok(lines.some((line) => line.includes("second line")));
	// Exactly one rendered meta line.
	assert.equal(lines.filter((line) => /gpt-5\s+OpenAI\s*$/.test(line.trim())).length, 1);
});

test("autocomplete lines after the bottom border stay below the frame", () => {
	const base = fakeBase(["/mod"], ["→ /model  pick a model", "  /modes  list modes"]);
	const lines = renderPlain(base);
	assert.equal(lines.at(-2)?.trim(), "→ /model  pick a model");
	assert.equal(lines.at(-1)?.trim(), "/modes  list modes");
	assert.ok(lines.findIndex((line) => line.includes("/mod")) < lines.length - 3);
	assert.equal(typeof base.borderColor, "function");
	assert.equal(base.borderColor("x"), "x", "borderColor is restored after render");
});

test("a nested Zentui frame from a wrapped base loses only its tagged meta line", () => {
	const inner = new WrappedPolishedEditor(
		fakeBase(["hello OpenAI gpt-5"]) as never,
		theme,
		() => defaultConfig,
		() => ({ modelLabel: "gpt-5", providerLabel: "OpenAI" }),
		() => "off",
	);
	const outer = new WrappedPolishedEditor(
		inner as never,
		theme,
		() => defaultConfig,
		() => ({ modelLabel: "gpt-5", providerLabel: "OpenAI" }),
		() => "off",
	);
	const lines = outer.render(60).map((line) => stripVTControlCharacters(line));
	assert.ok(lines.some((line) => line.includes("hello OpenAI gpt-5")));
});

test("thinking level max renders with its own color", () => {
	const config = mergeConfig({ colors: { editorThinkingMax: "#010203" } });
	const editor = new WrappedPolishedEditor(
		fakeBase(["x"]) as never,
		theme,
		() => config,
		() => ({ modelLabel: "m", providerLabel: "P" }),
		() => "max",
	);
	const meta = editor.render(40).find((line) => stripVTControlCharacters(line).includes("max"));
	assert.ok(meta);
	assert.ok(/38;2;1;2;3m|38;5;16m/.test(meta), meta);
});
