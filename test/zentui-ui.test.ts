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

test("borderless editors retain every visible row", () => {
	const base = { ...fakeBase([]), render: () => ["first user line", "middle user line", "last user line"] };
	const lines = renderPlain(base);
	for (const row of ["first user line", "middle user line", "last user line"]) {
		assert.ok(lines.some((line) => line.includes(row)), row);
	}
	const rules = renderPlain({ ...fakeBase([]), render: () => ["────", "body", "────"] });
	assert.equal(rules.filter((line) => line.trimEnd().endsWith("────") && line.trimEnd().length < 20).length, 2,
		"literal horizontal rules are content, not proven borders");
});

test("wrapped editors forward mouse geometry and live viewport capture", () => {
	for (const copyFriendly of [false, true]) {
		const config = mergeConfig({ features: { copyFriendly } });
		const received: unknown[] = [];
		const base = {
			...fakeBase(["first", "second"], ["completion"]),
			capturesViewportInput: true,
			handleMouse(event: unknown) { received.push(event); return { handled: true }; },
		};
		const editor = new WrappedPolishedEditor(base as never, theme, () => config,
			() => ({ modelLabel: "gpt-5", providerLabel: "OpenAI" }), () => "off");
		const lines = editor.render(60).map(stripVTControlCharacters);
		const event = { type: "click", button: "left", x: 4, y: 2, width: 60, height: lines.length,
			screenX: 4, screenY: 2, shift: false, alt: false, ctrl: false } as const;
		const body = lines.findIndex((line) => line.includes("first"));
		const offset = lines[body]!.indexOf("first");
		editor.handleMouse({ ...event, y: body });
		assert.deepEqual(received.pop(), { ...event, x: 4 - offset, y: 1, width: 60 - offset, height: 5 });
		editor.handleMouse({ ...event, x: 3, y: lines.length - 1 });
		assert.deepEqual(received.pop(), { ...event, x: 3, y: 4, width: 60 - offset, height: 5 });
		editor.handleMouse({ ...event, y: 0 });
		assert.equal(received.length, 0, "chrome never moves the cursor");
		assert.equal(editor.capturesViewportInput, true);
		base.capturesViewportInput = false;
		assert.equal(editor.capturesViewportInput, false);
	}
});

test("wrapped editors retain captured drag/release targets outside the frame", () => {
	const received: unknown[] = [];
	const base = {
		...fakeBase(["body"]),
		handleMouse(event: unknown) { received.push(event); return { capture: true }; },
	};
	const editor = new WrappedPolishedEditor(base as never, theme, () => defaultConfig,
		() => ({ modelLabel: "m", providerLabel: "P" }), () => "off");
	const lines = editor.render(60);
	const press = { type: "press", button: "left", x: 4, y: 2, width: 60, height: lines.length,
		screenX: 14, screenY: 12, shift: false, alt: false, ctrl: false } as const;
	const result = editor.handleMouse(press);
	assert.equal(result?.capture, true);
	editor.handleMouse({ ...press, type: "release", y: 0, screenY: 10 });
	assert.equal(received.length, 2, "release on top border still reaches the capturing base");
	assert.deepEqual(received[1], { ...press, type: "release", x: 2, y: -1, screenY: 10, width: 58, height: 3 });
	editor.handleMouse({ ...press, type: "click", y: 0 });
	assert.equal(received.length, 2, "release ends capture, chrome clicks are inert again");
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
