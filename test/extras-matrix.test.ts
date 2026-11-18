import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";

// "/sakura-matrix on" persists the config: keep it out of the suite's shared agent dir.
const agentDir = mkdtempSync(join(tmpdir(), "sakura-matrix-extras-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const { default: matrix } = await import("../extensions/matrix/index");
after(() => rmSync(agentDir, { recursive: true, force: true }));

function harness(idle: boolean) {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
	const widgets: string[] = [];
	const pi = {
		on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => void handlers.set(name, fn),
		registerCommand: (_name: string, options: typeof command) => void (command = options),
	};
	const ui = {
		theme: { getColorMode: () => "truecolor" },
		setWidget: (_key: string, content: unknown) => void widgets.push(content ? "on" : "off"),
		notify: () => {},
	};
	matrix(pi as never);
	const ctx = { mode: "tui", hasUI: true, ui, isIdle: () => idle };
	return {
		widgets,
		run: (args: string) => command!.handler(args, ctx),
		emit: async (name: string) => void (await handlers.get(name)?.({ type: name }, ctx)),
	};
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

test("'on' during a running preview keeps the rain for the rest of the run", async () => {
	const h = harness(false);
	await h.run("off");
	await h.run("preview");
	assert.equal(h.widgets.at(-1), "on");
	await h.run("on");
	mock.timers.tick(6_000);
	assert.equal(h.widgets.at(-1), "on", "the preview timer must not stop an enabled run");
	await h.emit("agent_end");
	assert.equal(h.widgets.at(-1), "off");
	await h.emit("session_shutdown");
	await h.run("off");
});

test("'on' while idle still lets a preview expire", async () => {
	const h = harness(true);
	await h.run("off");
	await h.run("preview");
	await h.run("on");
	mock.timers.tick(6_000);
	assert.equal(h.widgets.at(-1), "off");
	await h.emit("session_shutdown");
	await h.run("off");
});
