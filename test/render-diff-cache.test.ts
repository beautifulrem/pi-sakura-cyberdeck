import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { installToolExecutionStyle } from "../extensions/zentui/tool-execution";

const strip = (s: string) => s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const stockToolRender = ToolExecutionComponent.prototype.render;
let cleanup: () => void = () => {};
before(() => {
	initTheme("dark");
	cleanup = installToolExecutionStyle();
});
after(() => {
	cleanup();
	assert.equal(ToolExecutionComponent.prototype.render, stockToolRender);
});

function makeEdit() {
	return new ToolExecutionComponent(
		"edit",
		"call-1",
		{ path: "a.ts" },
		{},
		{ renderCall: () => new Text("edit a.ts", 0, 0), renderResult: () => new Text("diff body", 0, 0) },
		{ requestRender() {} } as never,
		"/tmp",
	);
}

const result = (diff: string) => ({ content: [{ type: "text", text: "ok" }], isError: false, details: { diff } }) as never;

/** Count `split` calls on one diff string: diffStats parses with `diff.split("\n")`. */
function countSplits(diff: string, run: () => void): number {
	const original = String.prototype.split;
	let calls = 0;
	String.prototype.split = function (this: string, ...args: unknown[]) {
		if (String(this) === diff) calls += 1;
		return Reflect.apply(original, this, args);
	} as typeof original;
	try {
		run();
	} finally {
		String.prototype.split = original;
	}
	return calls;
}

test("cached edit cards do not re-parse the result diff", () => {
	const diff = ["--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,3 @@", "-old", "+new", "+extra", " same", ...Array.from({ length: 500 }, (_, i) => ` ctx ${i}`)].join("\n");
	const tool = makeEdit();
	tool.updateResult(result(diff), false);
	const first = tool.render(60);
	assert.match(strip(first[1]!), /✓ EDIT · \+2 −1 · COMPLETE/);
	assert.equal(countSplits(diff, () => {
		for (let i = 0; i < 5; i++) assert.equal(tool.render(60), first, "cached frame reused");
	}), 0, "no diff parsing on cached frames");
	// A width change rebuilds the card but the result (and its stats) is unchanged.
	assert.equal(countSplits(diff, () => tool.render(70)), 0, "stats reused across widths");
});

test("diff counts follow a new or changed result", () => {
	const tool = makeEdit();
	tool.updateResult(result("@@ -1 +1 @@\n-a\n+b"), false);
	assert.match(strip(tool.render(60)[1]!), /\+1 −1/);
	tool.updateResult(result("@@ -1 +1,3 @@\n-a\n+b\n+c\n+d"), false);
	assert.match(strip(tool.render(60)[1]!), /\+3 −1/);
	// A result whose details are updated in place is not served stale counts either.
	const live = result("@@ -1 +1 @@\n-a\n+b") as { details: { diff: string } };
	tool.updateResult(live as never, false);
	assert.match(strip(tool.render(60)[1]!), /\+1 −1/);
	live.details.diff = "@@ -1,2 +1 @@\n-a\n-b\n+c";
	assert.match(strip(tool.render(60)[1]!), /\+1 −2/);
});
