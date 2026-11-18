import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { PolishedTuiConfig } from "../extensions/zentui/config";
import { installUserMessageStyle, renderUserMessageCard } from "../extensions/zentui/user-message";

// Pi's own start-anchored OSC 133 regexes (pi-tui dist/tui-main-screen.js, layout.js and
// tui-alt-screen.js in Pi 1.5.2). Pi only strips markers at the start of a line, and fullscreen
// previous/next-prompt navigation only finds prompts whose row starts with 133;A.
const OSC133_ZONE_PREFIX = /^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/;
const OSC133_PROMPT_START = /^\x1b\]133;A(?:\x07|\x1b\\)/;

const stockUserRender = UserMessageComponent.prototype.render;
let config = { features: { copyFriendly: false }, icons: { rail: "▐" } } as unknown as PolishedTuiConfig;
let cleanup: () => void = () => {};
before(() => {
	initTheme("dark");
	cleanup = installUserMessageStyle(undefined, () => config);
});
after(() => {
	cleanup();
	assert.equal(UserMessageComponent.prototype.render, stockUserRender);
});

function assertPiSeesMarkers(out: readonly string[], label: string): void {
	assert.equal(out.filter((line) => OSC133_PROMPT_START.test(line)).length, 1, `${label}: one prompt start Pi can navigate to`);
	for (const [row, line] of out.entries()) {
		assert.ok(!line.replace(OSC133_ZONE_PREFIX, "").includes("\x1b]133;"), `${label}: row ${row} leaks an OSC 133 marker to the terminal`);
	}
}

test("framed user messages keep Pi's OSC 133 prompt markers at line start", () => {
	for (const text of ["one line", "first\nsecond\n\nthird paragraph"]) {
		const user = new UserMessageComponent(text);
		for (const width of [20, 50, 120]) {
			const out = user.render(width);
			assertPiSeesMarkers(out, `${JSON.stringify(text)}@${width}`);
			assert.ok(out.join("").includes("\x1b]133;B\x07\x1b]133;C\x07"), "prompt end markers kept");
		}
	}
});

test("rail-less user message cards stay byte-identical to Pi's lines", () => {
	const inner = ["\x1b]133;A\x07top", "middle", "\x1b]133;B\x07\x1b]133;C\x07bottom"];
	assert.deepEqual(renderUserMessageCard(inner, 10, "", "─").slice(1, -1), inner);
	const railed = renderUserMessageCard(inner, 10, "R ", "─");
	assert.deepEqual(railed.slice(1, -1), ["\x1b]133;A\x07R top", "R middle", "\x1b]133;B\x07\x1b]133;C\x07R bottom"]);
	// A one-row body carries every marker on the same row (B, C then A after Pi's two writes).
	const single = renderUserMessageCard(["\x1b]133;B\x07\x1b]133;C\x07\x1b]133;A\x07x"], 10, "R ", "─");
	assert.equal(single[1], "\x1b]133;B\x07\x1b]133;C\x07\x1b]133;A\x07R x");
});
