import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
	DynamicBorder,
	initTheme,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text, visibleWidth } from "@earendil-works/pi-tui";
import type { PolishedTuiConfig } from "../extensions/zentui/config";
import { patchSelectorBorderStyle } from "../extensions/zentui/selector-border";
import {
	applyThinkingLabel,
	SAKURA_HIDDEN_THINKING_LABEL,
} from "../extensions/zentui/thinking-message";
import { installToolExecutionStyle } from "../extensions/zentui/tool-execution";
import { installUserMessageStyle } from "../extensions/zentui/user-message";

type AnyRecord = Record<string, any>;

const strip = (s: string) =>
	s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

// Snapshot the stock prototype methods before any patch is installed.
const stockToolRender = ToolExecutionComponent.prototype.render;
const stockUserRender = UserMessageComponent.prototype.render;

const config = {
	features: { copyFriendly: false },
	icons: { rail: "▐" },
} as unknown as PolishedTuiConfig;

let cleanups: Array<() => void> = [];
before(() => {
	initTheme("dark");
	cleanups = [installToolExecutionStyle(), installUserMessageStyle(undefined, () => config)];
});
after(() => {
	for (const cleanup of cleanups.reverse()) cleanup();
	assert.equal(ToolExecutionComponent.prototype.render, stockToolRender);
	assert.equal(UserMessageComponent.prototype.render, stockUserRender);
});

const ui = { requestRender() {} } as never;

function textComponent(text: string): Component {
	return new Text(text, 0, 0);
}

const TRICKY_BODY = [
	"ok looks like a status word",
	"Successfully sounds like success",
	"error: this is just output",
	"read_file is not a title",
	"    indented/path/like.ts",
	"\x1b[31mcolored\x1b[39m and trailing dots ...",
	"┌──────────┐",
	"───",
	"漢字かな交じり 🌸🎉 emoji",
].join("\n");

function makeTool(options: { body?: string; renderShell?: "default" | "self"; name?: string } = {}) {
	const body = options.body ?? TRICKY_BODY;
	return new ToolExecutionComponent(
		options.name ?? "read_file",
		"call-1",
		{ path: "a.ts" },
		{},
		{
			renderShell: options.renderShell,
			renderCall: (args: AnyRecord) => textComponent(`read ${args.path}`),
			renderResult: () => textComponent(body),
		},
		ui,
		"/tmp",
	);
}

function finish(tool: ToolExecutionComponent, isError: boolean, text = "done") {
	tool.updateResult({ content: [{ type: "text", text }], isError }, false);
}

test("tool card passes Pi's body lines through byte-for-byte inside the frame", () => {
	const tool = makeTool();
	finish(tool, false);
	const width = 60;
	const inner = stockToolRender.call(tool, width - 3);
	const out = tool.render(width);

	assert.equal(out[0], "", "Pi's spacer row stays above the frame");
	assert.equal(out.length, inner.length + 2, "only a title row and a bottom row are added");
	assert.match(strip(out[1]!), /^╭─ ✓ READ FILE ─+╮$/);
	assert.match(strip(out.at(-1)!), /^╰─+╯$/);
	for (let i = 1; i < inner.length; i++) {
		const line = out[i + 1]!;
		assert.ok(line.includes(inner[i]!), `body line ${i} unchanged`);
		assert.equal(strip(line), `┃ ${strip(inner[i]!)}│`);
	}
	const plainBody = out.map(strip).join("\n");
	for (const expected of ["ok looks like", "Successfully sounds", "error: this is", "    indented/path", "trailing dots ...", "┌──────────┐"]) {
		assert.ok(plainBody.includes(expected), `kept: ${expected}`);
	}
	assert.ok(!/[✓×›]\s*(?:ok|Successfully|error)/.test(plainBody), "no injected status glyphs");
});

test("tool status comes from component state, not body text", () => {
	const failed = makeTool({ body: "Successfully wrote everything" });
	finish(failed, true);
	assert.match(strip(failed.render(50)[1]!), /× READ FILE · FAILED/);

	const ok = makeTool({ body: "error: looks bad but is fine" });
	finish(ok, false);
	assert.match(strip(ok.render(50)[1]!), /✓ READ FILE/);

	const running = makeTool();
	assert.match(strip(running.render(50)[1]!), /◆ READ FILE · RUNNING/);
	running.updateResult({ content: [{ type: "text", text: "partial" }], isError: false }, true);
	assert.match(strip(running.render(50)[1]!), /RUNNING/);
});

test("expanded tool output is not capped", () => {
	const long = Array.from({ length: 450 }, (_, i) => `line ${i}`).join("\n");
	const tool = makeTool({ body: long });
	finish(tool, false);
	(tool as unknown as { setExpanded(v: boolean): void }).setExpanded(true);
	const inner = stockToolRender.call(tool, 77);
	const out = tool.render(80);
	assert.equal(out.length, inner.length + 2);
	assert.ok(strip(out.join("\n")).includes("line 449"));
});

test("settled tool card is cached (same array while nothing changed)", () => {
	const tool = makeTool();
	finish(tool, false);
	const first = tool.render(70);
	assert.equal(tool.render(70), first);
	assert.notEqual(tool.render(71), first);
	finish(tool, true);
	const failed = tool.render(71);
	assert.match(strip(failed[1]!), /FAILED/);
});

test("self-rendered tools stay stock", () => {
	const tool = makeTool({ renderShell: "self" });
	finish(tool, false);
	assert.deepEqual(tool.render(60), stockToolRender.call(tool, 60));
});

test("tool and user cards never exceed the requested width (CJK/emoji)", () => {
	const tool = makeTool({ body: `${"漢🌸".repeat(40)}\n${"x".repeat(200)}` });
	finish(tool, false);
	const user = new UserMessageComponent(`${"日本語🎉".repeat(30)}\n\n1) item`);
	for (let width = 12; width <= 90; width += 7) {
		for (const line of tool.render(width)) assert.ok(visibleWidth(line) <= width, `tool @${width}`);
		for (const line of user.render(width)) assert.ok(visibleWidth(line) <= width, `user @${width}`);
	}
});

test("fullscreen click on the framed body still toggles expansion; frame rows are inert", () => {
	const tool = makeTool({ body: Array.from({ length: 30 }, (_, i) => `row ${i}`).join("\n") });
	finish(tool, false);
	const width = 60;
	const out = tool.render(width);
	const state = tool as unknown as { expanded: boolean };
	const event = (y: number, x = 10) => ({
		type: "click" as const,
		button: "left" as const,
		x,
		y,
		screenX: x,
		screenY: y,
		width,
		height: out.length,
		shift: false,
		alt: false,
		ctrl: false,
	});

	assert.equal(tool.handleMouse(event(1)), undefined, "title row");
	assert.equal(tool.handleMouse(event(out.length - 1)), undefined, "bottom row");
	assert.equal(tool.handleMouse(event(4, 0)), undefined, "rail column");
	assert.equal(state.expanded, false);

	const row = out.findIndex((line) => strip(line).includes("row 3"));
	assert.ok(row > 1);
	const result = tool.handleMouse(event(row));
	assert.ok(result, "click handled by Pi's result region");
	assert.equal(state.expanded, true);
});

test("user message keeps Pi's markdown options, transforms and OSC 133 markers", () => {
	const text = "1) first\n2) second\n\n\\*not emphasis\\*";
	const user = new UserMessageComponent(text);
	const width = 50;
	const out = user.render(width);
	const inner = stockUserRender.call(user, width - 2);

	assert.equal(out.length, inner.length + 2);
	assert.match(strip(out[0]!), /^─{50}$/);
	assert.match(strip(out.at(-1)!), /^─{50}$/);
	for (let i = 0; i < inner.length; i++) {
		assert.ok(out[i + 1]!.endsWith(inner[i]!), `inner line ${i} passed through`);
		assert.equal(strip(out[i + 1]!), `▐ ${strip(inner[i]!)}`);
	}
	const plain = out.map(strip).join("\n");
	assert.ok(plain.includes("1) first"), "ordered list marker preserved");
	assert.ok(plain.includes("*not emphasis*") || plain.includes("\\*not emphasis\\*"));
	assert.ok(out[1]!.includes("\x1b]133;A\x07"));
	assert.ok(out.at(-2)!.includes("\x1b]133;B\x07\x1b]133;C\x07"));
	assert.equal(user.render(width), out, "cached while unchanged");
});

test("user message honours copy-friendly mode (no rail, full-width body)", () => {
	const copyConfig = { features: { copyFriendly: true }, icons: { rail: "▐" } } as unknown as PolishedTuiConfig;
	const cleanup = installUserMessageStyle(undefined, () => copyConfig);
	try {
		const user = new UserMessageComponent("hello");
		const out = user.render(40);
		const inner = stockUserRender.call(user, 40);
		assert.deepEqual(out.slice(1, -1), inner);
	} finally {
		cleanup();
		cleanups[1] = installUserMessageStyle(undefined, () => config);
	}
});

test("selector border only recolors DynamicBorder rows at first/last position", () => {
	class FakeSelector extends Container {
		constructor(first: Component, last: Component) {
			super();
			this.addChild(first);
			this.addChild(new Text("───", 0, 0));
			this.addChild(last);
		}
	}
	const cleanup = patchSelectorBorderStyle(FakeSelector.prototype);
	try {
		const bordered = new FakeSelector(new DynamicBorder(), new DynamicBorder()).render(20);
		assert.match(strip(bordered[0]!), /^─{20}$/);
		assert.ok(bordered[0]!.includes("\x1b[38;"), "gradient applied");
		assert.equal(strip(bordered[1]!).trim(), "───");
		assert.ok(!bordered[1]!.includes("\x1b[38;2;242"), "middle content untouched");

		const plain = new FakeSelector(new Text("─────", 0, 0), new Text("x", 0, 0));
		const stock = Container.prototype.render.call(plain, 20);
		assert.deepEqual(plain.render(20), stock, "non-DynamicBorder rows stay stock");
	} finally {
		cleanup();
	}
});

test("thinking label uses the public setHiddenThinkingLabel API and fails safe", () => {
	const calls: Array<string | undefined> = [];
	applyThinkingLabel({ ui: { setHiddenThinkingLabel: (label?: string) => calls.push(label) } });
	applyThinkingLabel({ ui: { setHiddenThinkingLabel: (label?: string) => calls.push(label) } }, false);
	assert.equal(strip(calls[0] ?? ""), SAKURA_HIDDEN_THINKING_LABEL);
	assert.equal(calls[1], undefined);
	assert.equal(calls.length, 2);
	assert.doesNotThrow(() => applyThinkingLabel({ ui: {} }));
	assert.doesNotThrow(() => applyThinkingLabel({}));
	assert.doesNotThrow(() =>
		applyThinkingLabel({
			ui: {
				setHiddenThinkingLabel() {
					throw new Error("unsupported");
				},
			},
		}),
	);
});
