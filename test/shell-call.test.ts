import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import * as host from "@earendil-works/pi-coding-agent";
import { initTheme, type ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { getColorMode, setColorMode } from "../extensions/shared/color";
import { registerShellCallRenderer } from "../extensions/zentui/shell-call";
import { installToolExecutionStyle } from "../extensions/zentui/tool-execution";

type CallContext = Parameters<NonNullable<NonNullable<ReturnType<ToolRendererResolver>>["renderCall"]>>[2];
initTheme("dark");
const theme = { fg: (_role: string, text: string) => text } as never;

function setup() {
	let resolver!: ToolRendererResolver;
	let enabled = true;
	let nativeCalls = 0;
	const result = () => new Text("native Warning/Error output", 0, 0);
	const original = {
		renderCall: () => { nativeCalls++; return new Text("$ native", 0, 0); },
		renderResult: result,
	};
	registerShellCallRenderer({ registerToolRenderer(fn: ToolRendererResolver) { resolver = fn; } } as never, () => enabled);
	const renderers = resolver("bash", () => original)!;
	const context = { expanded: false, state: {}, keyHint: () => "\x1b[32mCUSTOM-KEY\x1b[39m to expand" } as unknown as CallContext;
	return { resolver, original, renderers, context, nativeCalls: () => nativeCalls, disable: () => { enabled = false; } };
}

test("shell command uses ❯, native syntax, timeout, wrapping and expansion without touching results", (t) => {
	const oldMode = getColorMode();
	t.after(() => setColorMode(oldMode));
	setColorMode("none");
	const h = setup();
	assert.equal(h.renderers.renderResult, h.original.renderResult, "native output renderer stays untouched");
	assert.equal(h.resolver("edit", () => h.original), h.original);
	const command = "cd pi-sakura-cyberdeck && npm run typecheck && npm test";
	const args = { command, timeout: 120 };
	const component = h.renderers.renderCall!(args, theme, h.context);
	assert.equal(component.render(120).map(strip).join("\n"), `❯ ${command} (timeout 120s)`);
	assert.equal(h.nativeCalls(), 1, "native timer/state initialization still runs");
	const long = { command: "printf '%s\\n' \"$HOME\" && echo 中文 👨‍👩‍👧‍👦\n".repeat(20) };
	const folded = h.renderers.renderCall!(long, theme, { ...h.context, lastComponent: component });
	const cachedPreview = folded.render(50);
	assert.equal(folded.render(50), cachedPreview, "unchanged command rows reuse wrapped output");
	assert.doesNotMatch(cachedPreview.join("\n"), /\x1b/, "NO_COLOR also applies to host-colored key hints");
	const preview = cachedPreview.map(strip);
	assert.ok(preview.some((line) => line.includes("CUSTOM-KEY")));
	const expanded = h.renderers.renderCall!(long, theme, { ...h.context, expanded: true, lastComponent: folded });
	assert.equal(expanded, folded, "reuse the row-local component");
	assert.ok(expanded.render(50).length > preview.length);
	const sixLines = h.renderers.renderCall!({ command: Array(6).fill("echo a").join("\n") }, theme, h.context);
	for (const width of [20, 30, 40]) assert.equal(sixLines.render(width).length, 6, "folding never adds wrapped hint rows");
	for (const width of [1, 2, 3, 4, 7, 20, 50]) {
		for (const line of expanded.render(width)) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
	}
	setColorMode("truecolor");
	const colored = h.renderers.renderCall!({ command: "if true; then echo \"$HOME\"; fi # comment" }, theme, h.context).render(120).join("\n");
	assert.ok(new Set(colored.match(/\x1b\[38;[^m]+m/g)).size >= 3, "keywords, strings, variables and comments get syntax colors");
	h.disable();
	assert.deepEqual(component.render(120).map((line) => strip(line).trimEnd()), ["$ native"], "feature toggle restores native header");
	assert.deepEqual(args, { command, timeout: 120 }, "display changes never alter tool arguments");
});

test("Pi's real Bash renderer retains timers, truncation warnings and output inside the card", (t) => {
	if (typeof host.createBashToolDefinition !== "function") { t.skip("host has no standalone shell definition factory"); return; }
	let resolver!: ToolRendererResolver;
	registerShellCallRenderer({ registerToolRenderer(fn: ToolRendererResolver) { resolver = fn; } } as never, () => true);
	const native = host.createBashToolDefinition("/tmp");
	const renderer = resolver("bash", () => native as never)!;
	assert.equal(renderer.renderResult, native.renderResult);
	const cleanup = installToolExecutionStyle();
	t.after(cleanup);
	const tool = new host.ToolExecutionComponent("bash", "shell-check", {
		command: "cd pi-sakura-cyberdeck && npm run typecheck && npm test", timeout: 120,
	}, {}, renderer, { requestRender() {} } as never, "/tmp");
	tool.markExecutionStarted();
	try {
		assert.match(tool.render(120).map(strip).join("\n"), /◆ BASH · RUNNING/);
	} finally {
		tool.updateResult({ content: [{ type: "text", text: "Warning: literal log\nError: literal log" }],
			isError: false, durationMs: 1234,
			details: { fullOutputPath: "/tmp/full-output.txt", truncation: { truncated: true, truncatedBy: "lines", outputLines: 2, totalLines: 20 } } }, false);
	}
	const lines = tool.render(120).map(strip).join("\n");
	assert.match(lines, /✓ BASH · COMPLETE/);
	assert.match(lines, /❯ cd pi-sakura-cyberdeck && npm run typecheck && npm test \(timeout 120s\)/);
	assert.match(lines, /Warning: literal log/);
	assert.match(lines, /Error: literal log/);
	assert.match(lines, /Full output: \/tmp\/full-output.txt/);
	assert.match(lines, /Truncated:/);
	assert.match(lines, /Took \d+\.\ds/, "native timer completes on old and current hosts");
});

test("shell call display strips hostile terminal controls and invalid arguments fall back", (t) => {
	const oldMode = getColorMode();
	t.after(() => setColorMode(oldMode));
	setColorMode("none");
	const h = setup();
	const component = h.renderers.renderCall!({ command: "echo \x1b[2Jsafe\x1b]0;evil\x07\u202e", timeout: "bad" }, theme, h.context);
	assert.equal(component.render(80).join("\n"), "❯ echo safe");
	const invalid = h.renderers.renderCall!({ command: null }, theme, h.context);
	assert.deepEqual(invalid.render(80).map((line) => strip(line).trimEnd()), ["$ native"]);
	assert.doesNotThrow(() => registerShellCallRenderer({} as never, () => true), "older hosts stay native");
});
