import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import claudeShimmer from "../extensions/claude-shimmer/index";

type Handler = (event: any, ctx: any) => unknown;

function harness() {
	const handlers = new Map<string, Handler>();
	const notices: string[] = [];
	const pi = { on: (name: string, fn: Handler) => void handlers.set(name, fn), getThinkingLevel: () => "high", registerCommand: () => {} };
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			theme: { getColorMode: () => "truecolor" },
			setWorkingMessage: () => {},
			setWorkingIndicator: () => {},
			notify: (message: string) => void notices.push(message),
		},
	};
	claudeShimmer(pi as never);
	const emit = async (name: string, event: Record<string, unknown> = {}) => void (await handlers.get(name)?.({ type: name, ...event }, ctx));
	return { emit, notices };
}

const done = { role: "assistant", content: [{ type: "text", text: "done" }], usage: { output: 3, input: 1 }, stopReason: "stop" };

beforeEach(() => mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 }));
afterEach(() => mock.timers.reset());

test("Esc after agent_end (compaction, before-settle work) suppresses the success notice", async () => {
	const h = harness();
	await h.emit("agent_start");
	await h.emit("message_end", { message: done });
	await h.emit("agent_end", { messages: [done] });
	await h.emit("agent_settled", { aborted: true });
	assert.deepEqual(h.notices, []);
});

test("settled runs that were not aborted still announce, with or without the field", async () => {
	for (const extra of [{ aborted: false }, {}]) {
		const h = harness();
		await h.emit("agent_start");
		await h.emit("message_end", { message: done });
		await h.emit("agent_end", { messages: [done] });
		await h.emit("agent_settled", extra);
		assert.equal(h.notices.length, 1, JSON.stringify(extra));
	}
});
