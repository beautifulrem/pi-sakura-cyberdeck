import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseFooterFormat,
	renderFormatSplit,
	stripOrphanSeparators,
} from "../extensions/zentui/footer-format";

test("parse results are cached per format string", () => {
	const format = "$cwd( on $git_branch)$fill($context)";
	const first = parseFooterFormat(format);
	assert.equal(parseFooterFormat(format), first);
	assert.notEqual(parseFooterFormat(`${format} `), first);
});

test("each variable renders once per frame, even inside nested groups", () => {
	const calls = new Map<string, number>();
	const values: Record<string, string> = { cwd: "~/p", git_branch: "", git_status: "", tokens: "↑1" };
	const render = (name: string) => {
		calls.set(name, (calls.get(name) ?? 0) + 1);
		return values[name] ?? "";
	};
	const tokens = parseFooterFormat("$cwd( on $git_branch( [$git_status]))$fill(($tokens))");
	const out = renderFormatSplit(tokens, render);
	assert.deepEqual(out, { left: "~/p", middle: "", right: "↑1" });
	for (const [name, count] of calls) assert.equal(count, 1, name);
});

test("conditional groups: empty content drops, text-only shows, $sep-only drops", () => {
	const render = (name: string) => (name === "a" ? "A" : name === "sep" ? " | " : "");
	const split = (format: string) => renderFormatSplit(parseFooterFormat(format), render).left;
	assert.equal(split("x($b)y"), "xy");
	assert.equal(split("x($a)y"), "xAy");
	assert.equal(split("x( lit )y"), "x lit y");
	assert.equal(split("x($sep)y"), "xy");
	assert.equal(split("x($sep$b)y"), "xy");
	assert.equal(split("x($sep$a)y"), "x | Ay");
	assert.equal(split("$a) tail"), "A) tail");
});

test("fill splits into left / middle / right", () => {
	const render = (name: string) => name.toUpperCase();
	assert.deepEqual(renderFormatSplit(parseFooterFormat("$a$fill$b$fill$c"), render), {
		left: "A",
		middle: "B",
		right: "C",
	});
});

test("orphan separators honor the configured glyph and the classic pipe", () => {
	const sgr = (text: string) => `\x1b[38;5;244m${text}\x1b[0m`;
	assert.equal(stripOrphanSeparators(`${sgr(" › ")}A${sgr(" › ")}${sgr(" › ")}B${sgr(" › ")}`, "›"), `A${sgr(" › ")}B`);
	assert.equal(stripOrphanSeparators(" | A |  | B | ", "›"), "A | B");
	assert.equal(stripOrphanSeparators(" · A · ", "·"), "A");
	assert.equal(stripOrphanSeparators(" · A · ", "|"), "· A ·");
	assert.equal(stripOrphanSeparators(`  ${sgr("")}  `, ""), "");
});
