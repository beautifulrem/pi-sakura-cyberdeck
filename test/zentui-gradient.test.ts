import assert from "node:assert/strict";
import { test } from "node:test";
import { setColorMode } from "../extensions/shared/color";
import { gradientCacheSize, renderSakuraGradient, splitGraphemes } from "../extensions/zentui/gradient";

test("animated frames never grow the gradient cache", () => {
	setColorMode("truecolor");
	renderSakuraGradient("stable-cache-probe");
	const size = gradientCacheSize();
	for (let frame = 1; frame < 400; frame++) renderSakuraGradient("stable-cache-probe", frame / 400);
	assert.equal(gradientCacheSize(), size);
	const cached = renderSakuraGradient("stable-cache-probe");
	assert.equal(renderSakuraGradient("stable-cache-probe"), cached);
});

test("gradient follows the color mode", () => {
	setColorMode("truecolor");
	assert.match(renderSakuraGradient("ab"), /\x1b\[38;2;/);
	setColorMode("256color");
	const indexed = renderSakuraGradient("ab");
	assert.match(indexed, /\x1b\[38;5;\d+m/);
	assert.doesNotMatch(indexed, /38;2;/);
	setColorMode("none");
	assert.equal(renderSakuraGradient("ab"), "ab");
	setColorMode("truecolor");
});

const TECHNOLOGIST = "\u{1F469}\u200D\u{1F4BB}";
const E_ACUTE = "e\u0301";

test("grapheme clusters are painted as one unit", () => {
	assert.deepEqual(splitGraphemes("abc"), ["a", "b", "c"]);
	assert.deepEqual(splitGraphemes(`${TECHNOLOGIST}${E_ACUTE}`), [TECHNOLOGIST, E_ACUTE]);
	setColorMode("truecolor");
	const rendered = renderSakuraGradient(`${TECHNOLOGIST}${E_ACUTE}x`);
	assert.ok(rendered.includes(TECHNOLOGIST), "ZWJ sequence must not be split by color codes");
	assert.ok(rendered.includes(E_ACUTE), "combining mark must stay attached");
});
