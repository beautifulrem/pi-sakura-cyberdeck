import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseFooterFormat,
	renderFormatSplit,
	stripOrphanSeparators,
} from "../extensions/zentui/footer-format";
import { renderStyle, renderStyleForSource } from "../extensions/zentui/style";

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

test("literal | separators never eat a neighbouring segment's colour or reset", () => {
	// Real styled segments: terminal style closes with ESC[0m, theme style with ESC[39m / ESC[22m.
	const theme = {
		fg: (_color: string, text: string) => `\x1b[38;5;200m${text}\x1b[39m`,
		bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
	};
	const a = renderStyle(theme, "bold #ff88cc", "AAA");
	const c = renderStyle(theme, "green", "CCC");
	const themed = renderStyleForSource(theme, "theme", "bold accent", "TTT");
	const values: Record<string, string> = { a, b: "", c, t: themed };
	const line = (format: string) =>
		stripOrphanSeparators(
			renderFormatSplit(parseFooterFormat(format), (name) => values[name] ?? "").left,
			"›",
		);
	assert.equal(line("$b | $c"), c);
	assert.equal(line("$a | $b | $c"), `${a} | ${c}`);
	assert.equal(line("$a | $b"), a);
	assert.equal(line("$a | $c"), `${a} | ${c}`);
	assert.equal(line("$t | $b | $a"), `${themed} | ${a}`);
	assert.equal(line("$b | $t"), themed);
	assert.equal(line("$t | $b"), themed);
});

test("styled $sep units still collapse and strip as a whole", () => {
	const theme = {
		fg: (_color: string, text: string) => `\x1b[38;5;244m${text}\x1b[39m`,
		bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
	};
	const a = renderStyle(theme, "bold #ff88cc", "AAA");
	for (const sep of [
		renderStyle(theme, "#888888", " › "),
		renderStyleForSource(theme, "theme", "muted", " › "),
		renderStyleForSource(theme, "theme", "bold muted", " › "),
		// Pi's faint theme tokens: `fg` opens with colour + SGR 2 and closes with ESC[22;39m.
		`\x1b[38;5;244m\x1b[2m › \x1b[22;39m`,
	]) {
		assert.equal(stripOrphanSeparators(`${sep}${a}${sep}${sep}${a}${sep}`, "›"), `${a}${sep}${a}`);
	}
});
