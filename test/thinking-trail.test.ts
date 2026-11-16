import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { getColorMode, setColorMode } from "../extensions/shared/color";
import { defaultConfig, mergeConfig } from "../extensions/zentui/config";
import { parseDirectCommand } from "../extensions/zentui/settings-command";
import {
	buildThinkingTrail,
	makeThinkingTrailTransformer,
	thinkingSteps,
} from "../extensions/zentui/thinking-trail";

const BODY_RAIL = /^(?:├─ ◇|╰─ ◇|│    |     )/;
initTheme("dark");

function plainTrail(source: string | undefined, width = 100): string {
	assert.ok(source);
	return new Markdown(source, 0, 0, getMarkdownTheme()).render(width)
		.map((line) => stripVTControlCharacters(line).trimEnd()).join("  \n");
}

// The colour mode is global; other test files may share this process (bun) rather than
// getting their own (node --test), so always restore it.
const ORIGINAL_COLOR_MODE = getColorMode();
afterEach(() => setColorMode(ORIGINAL_COLOR_MODE));

test("thinkingSteps splits paragraphs and keeps the first line of each", () => {
	assert.deepEqual(
		thinkingSteps("First step line\nmore detail\n\nSecond   step\ncontinued"),
		["First step line", "Second step"],
	);
	assert.deepEqual(thinkingSteps("\n\n   \n"), []);
});

test("buildThinkingTrail renders a labelled tree with hard line breaks", () => {
	setColorMode("none");
	const trail = buildThinkingTrail("Now update the test.\n\nThen run bun test.\n\nFinally update docs.");
	assert.equal(
		plainTrail(trail),
		"✦ Thought trail · 3 steps  \n" +
			"├─ ◇ Now update the test.  \n" +
			"├─ ◇ Then run bun test.  \n" +
			"╰─ ◇ Finally update docs.",
	);
});

test("wrapped step rows keep the rail so the tree never breaks at a soft wrap", () => {
	setColorMode("none");
	const trail = buildThinkingTrail(
		"Second step that is quite long and should wrap around a narrow terminal width nicely.",
		30,
	);
	assert.ok(trail);
	const lines = plainTrail(trail, 30).split("  \n");
	assert.ok(lines.length > 2, "the step wrapped");
	for (const line of lines.slice(1)) assert.match(line, BODY_RAIL, line);
	assert.equal(lines.at(-1), "     width nicely.");
	assert.equal(lines[1], "╰─ ◇ Second step that is quite");
});

test("buildThinkingTrail has no count for a single step and returns undefined for blank text", () => {
	setColorMode("none");
	assert.equal(plainTrail(buildThinkingTrail("Just one thought.")), "✦ Thought trail  \n╰─ ◇ Just one thought.");
	assert.equal(buildThinkingTrail("   \n\n  "), undefined);
});

test("buildThinkingTrail caps the body and reports what was hidden", () => {
	setColorMode("none");
	const trail = buildThinkingTrail(Array.from({ length: 20 }, (_, i) => `step ${i}`).join("\n\n"));
	assert.ok(trail);
	const lines = plainTrail(trail).split("  \n");
	assert.equal(lines.length, 1 + 16 + 1);
	assert.equal(lines.at(-1), "╰─ … +4 more");
	for (const line of lines.slice(1, -1)) assert.match(line, BODY_RAIL, line);
});

test("rails are sakura-gradient colored and body lines are well-formed SGR spans", () => {
	setColorMode("truecolor");
	const trail = buildThinkingTrail("Only one step here.");
	assert.ok(trail);
	const [header, body] = trail!.split("  \n");
	// Header: full gradient, terminated by a reset.
	assert.match(header!, /^\x1b\[38;2;\d+;\d+;\d+m✦/);
	assert.ok(header!.endsWith("\x1b[0m"));
	// Body: gradient rail, then the soft thinking tint, then a terminating reset.
	assert.match(body!, /^` \x1b\[38;2;\d+;\d+;\d+m[├╰]/);
	assert.ok(body!.includes("\x1b[38;2;216;202;220m"));
	assert.ok(body!.endsWith("\x1b[0m `"));
	setColorMode("none");
});

test("the transformer only rewrites visible assistant thinking, yields the width, and honours the toggle", () => {
	setColorMode("none");
	const enabled = makeThinkingTrailTransformer(() => true);
	const disabled = makeThinkingTrailTransformer(() => false);
	const context = {
		messageType: "assistant-thinking",
		isStreaming: false,
		availableWidth: 24,
	} as const;

	assert.equal(plainTrail(enabled("A short thought.", context), 24), "✦ Thought trail  \n╰─ ◇ A short thought.");
	assert.equal(disabled("Hello.", context), "Hello.");
	assert.equal(
		enabled("Hello.", { ...context, messageType: "assistant" }),
		"Hello.",
		"assistant text is left untouched",
	);
});

test("real Markdown rendering never reparses rails, code, links, math or controls", () => {
	const samples = [
		"Review `" + "dispatcher: options.dispatcher must use shared configuration. ".repeat(12) + "` before editing.",
		"[link](https://example.com/a_very_long_path) <!-- visible digest --> **strong** $x$ \\(math\\) \\[math\\]",
		"Use ``backticks ` inside`` then ``` and 中文组合e\u0301 👨‍👩‍👧‍👦 ".repeat(8),
		"streaming with unmatched `" + "long text ".repeat(25),
		"safe\x1b[2Jtitle\x1b]0;evil\x07 \b\x7f\x9b\u202e text",
	];
	for (const mode of ["none", "256color", "truecolor"] as const) {
		setColorMode(mode);
		for (const width of [7, 30, 120, 140, 160]) {
			for (const sample of samples) {
				const source = buildThinkingTrail(`${sample}\n\nNext step.`, width)!;
				const expected = source.split("  \n").map((line) =>
					stripVTControlCharacters(line.replace(/^(`+) (.*) \1$/, "$2")).trimEnd());
				const actual = plainTrail(source, width).split("  \n");
				assert.deepEqual(actual, expected, `${mode}/${width}: ${sample}`);
				for (const line of actual) assert.ok(visibleWidth(line) <= width, line);
				assert.doesNotMatch(source, /\x1b\[2J|\x1b\]0;|[\b\x7f\x9b\u202e]/);
			}
		}
	}
	for (const width of [0, 1, 5, 6]) assert.equal(buildThinkingTrail("中文", width), undefined);
});

test("thinkingTrail is on by default and toggleable", () => {
	assert.equal(defaultConfig.features.thinkingTrail, true);
	assert.equal(mergeConfig({}).features.thinkingTrail, true);
	assert.equal(mergeConfig({ features: { thinkingTrail: false } }).features.thinkingTrail, false);
	assert.deepEqual(parseDirectCommand("thinking-trail off", defaultConfig), {
		kind: "feature",
		feature: "thinkingTrail",
		enabled: false,
	});
	assert.deepEqual(parseDirectCommand("trail toggle", defaultConfig), {
		kind: "feature",
		feature: "thinkingTrail",
		enabled: false,
	});
});
