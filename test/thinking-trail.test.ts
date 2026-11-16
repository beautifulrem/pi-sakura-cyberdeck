import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getColorMode, setColorMode } from "../extensions/shared/color";
import { defaultConfig, mergeConfig } from "../extensions/zentui/config";
import { parseDirectCommand } from "../extensions/zentui/settings-command";
import {
	buildThinkingTrail,
	makeThinkingTrailTransformer,
	thinkingSteps,
} from "../extensions/zentui/thinking-trail";

const BODY_RAIL = /^(?:├─ ◇|╰─ ◇|│    |     )/;

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
		trail,
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
	const lines = trail.split("  \n");
	assert.ok(lines.length > 2, "the step wrapped");
	for (const line of lines.slice(1)) assert.match(line, BODY_RAIL, line);
	assert.equal(lines.at(-1), "     width nicely.");
	assert.equal(lines[1], "╰─ ◇ Second step that is quite");
});

test("buildThinkingTrail has no count for a single step and returns undefined for blank text", () => {
	setColorMode("none");
	assert.equal(buildThinkingTrail("Just one thought."), "✦ Thought trail  \n╰─ ◇ Just one thought.");
	assert.equal(buildThinkingTrail("   \n\n  "), undefined);
});

test("buildThinkingTrail caps the body and reports what was hidden", () => {
	setColorMode("none");
	const trail = buildThinkingTrail(Array.from({ length: 20 }, (_, i) => `step ${i}`).join("\n\n"));
	assert.ok(trail);
	const lines = trail.split("  \n");
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
	assert.match(body!, /^\x1b\[38;2;\d+;\d+;\d+m[├╰]/);
	assert.ok(body!.includes("\x1b[38;2;216;202;220m"));
	assert.ok(body!.endsWith("\x1b[0m"));
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

	assert.equal(enabled("A short thought.", context), "✦ Thought trail  \n╰─ ◇ A short thought.");
	assert.equal(disabled("Hello.", context), "Hello.");
	assert.equal(
		enabled("Hello.", { ...context, messageType: "assistant" }),
		"Hello.",
		"assistant text is left untouched",
	);
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
