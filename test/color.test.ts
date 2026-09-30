import assert from "node:assert/strict";
import { test } from "node:test";
import { bgAnsi, detectColorMode, fgAnsi, hexToRgb, paintFg, rgbTo256, syncColorMode } from "../extensions/shared/color";

test("detectColorMode honors NO_COLOR, COLORTERM and falls back to 256 colors", () => {
	assert.equal(detectColorMode({ NO_COLOR: "1", COLORTERM: "truecolor" }), "none");
	assert.equal(detectColorMode({ COLORTERM: "truecolor" }), "truecolor");
	assert.equal(detectColorMode({ TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" }), "256color");
	assert.equal(detectColorMode({ TERM: "xterm-direct" }), "truecolor");
});

test("fg/bg sequences follow the color mode", () => {
	assert.equal(fgAnsi([242, 167, 198], "truecolor"), "\x1b[38;2;242;167;198m");
	assert.match(fgAnsi([242, 167, 198], "256color"), /^\x1b\[38;5;\d+m$/);
	assert.equal(bgAnsi([0, 0, 0], "none"), "");
	assert.equal(paintFg([1, 2, 3], "x", "none"), "x");
});

test("rgbTo256 maps primaries and grays sensibly", () => {
	assert.equal(rgbTo256([255, 0, 0]), 196);
	assert.equal(rgbTo256([0, 0, 0]), 16);
	assert.equal(rgbTo256([128, 128, 128]), 244);
});

test("syncColorMode adopts Pi's theme mode", () => {
	const saved = process.env.NO_COLOR;
	delete process.env.NO_COLOR;
	assert.equal(syncColorMode({ getColorMode: () => "256color" }), "256color");
	assert.equal(syncColorMode({ getColorMode: () => "truecolor" }), "truecolor");
	if (saved !== undefined) process.env.NO_COLOR = saved;
});

test("hexToRgb parses short and long forms", () => {
	assert.deepEqual(hexToRgb("#f2a7c6"), [242, 167, 198]);
	assert.deepEqual(hexToRgb("fff"), [255, 255, 255]);
});
