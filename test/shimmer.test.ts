import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import claudeShimmer, {
  completionNotice,
  estimateOutputTokens,
  estimateTextTokens,
  finalTokenReading,
  formatTokenCount,
  isInteractiveTui,
  liveTokenReading,
  outcomeFromStopReason,
  pickVerb,
  reportedOutputTokens,
  sweepPosition,
  TICK_MS,
  tweenTokens,
  VERBS,
} from "../extensions/claude-shimmer/index";
import { setColorMode } from "../extensions/shared/color";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ─── Pure helpers ─────────────────────────────────────────────────

test("formatTokenCount always says token(s)", () => {
  assert.equal(formatTokenCount(1), "1 token");
  assert.equal(formatTokenCount(128), "128 tokens");
  assert.equal(formatTokenCount(1234), "1.2k tokens");
  assert.equal(formatTokenCount(-3), "0 tokens");
});

test("estimates: © ® ™ count like normal chars, emoji count double", () => {
  assert.equal(estimateTextTokens("©®™"), estimateTextTokens("éüñ"));
  assert.ok(estimateTextTokens("😀😀") > estimateTextTokens("©®"));
  assert.equal(estimateTextTokens("abcd".repeat(100)), 100);
  assert.equal(estimateOutputTokens({ content: [{ type: "text", text: "x".repeat(40) }, { type: "thinking", thinking: "y".repeat(40) }] }), 20);
});

test("streaming stub usage (Anthropic output≈1) never hides the estimate", () => {
  assert.deepEqual(liveTokenReading(1, 500), { tokens: 500, estimated: true });
  assert.deepEqual(liveTokenReading(null, 20), { tokens: 20, estimated: true });
  assert.deepEqual(liveTokenReading(600, 500), { tokens: 600, estimated: false });
  assert.deepEqual(liveTokenReading(null, 0), { tokens: 0, estimated: false });
  // Zero-filled streaming usage is "not reported".
  assert.equal(reportedOutputTokens({ usage: { output: 0 } }), null);
});

test("final usage is authoritative only for normal stops", () => {
  const content = [{ type: "text", text: "x".repeat(4000) }]; // ≈1000 tokens
  assert.deepEqual(finalTokenReading({ content, usage: { output: 800, input: 10 }, stopReason: "stop" }), { tokens: 800, estimated: false });
  assert.deepEqual(finalTokenReading({ content, usage: { output: 1, input: 10 }, stopReason: "aborted" }), { tokens: 1000, estimated: true });
  assert.deepEqual(finalTokenReading({ content, usage: { output: 1, input: 10 }, stopReason: "error" }), { tokens: 1000, estimated: true });
  assert.deepEqual(finalTokenReading({ content, stopReason: "stop" }), { tokens: 1000, estimated: true });
  assert.deepEqual(finalTokenReading({ content: [], usage: { output: 0, input: 5 }, stopReason: "stop" }), { tokens: 0, estimated: false });
});

test("completion notice only on success", () => {
  assert.equal(completionNotice("completed", 12_400, () => 0), "✻ Baked for 12s");
  assert.equal(completionNotice("aborted", 12_400), undefined);
  assert.equal(completionNotice("error", 12_400), undefined);
  assert.equal(outcomeFromStopReason("aborted"), "aborted");
  assert.equal(outcomeFromStopReason("error"), "error");
  assert.equal(outcomeFromStopReason("toolUse"), "completed");
  assert.equal(outcomeFromStopReason(undefined), "completed");
});

test("sweep highlight enters and leaves from outside the text", () => {
  assert.equal(sweepPosition(10, 0, false), -5);
  assert.equal(sweepPosition(10, 19, false), 14);
  assert.equal(sweepPosition(10, 20, false), -5);
  assert.equal(sweepPosition(10, 0, true), 14);
  assert.equal(sweepPosition(10, 19, true), -5);
});

test("token tween converges in both directions", () => {
  let v = 0;
  for (let i = 0; i < 40 && v !== 2000; i++) v = tweenTokens(v, 2000);
  assert.equal(v, 2000);
  for (let i = 0; i < 40 && v !== 10; i++) v = tweenTokens(v, 10);
  assert.equal(v, 10);
});

test("verbs: trimmed list, deterministic pick", () => {
  assert.ok(VERBS.length >= 40 && VERBS.length <= 60);
  assert.equal(pickVerb(() => 0), VERBS[0]);
  assert.equal(pickVerb(() => 0.999999), VERBS[VERBS.length - 1]);
});

test("isInteractiveTui prefers ctx.mode and falls back to hasUI", () => {
  assert.equal(isInteractiveTui({ mode: "tui", hasUI: true }), true);
  assert.equal(isInteractiveTui({ mode: "rpc", hasUI: true }), false);
  assert.equal(isInteractiveTui({ mode: undefined as never, hasUI: true }), true);
  assert.equal(isInteractiveTui(undefined), false);
});

// ─── Handler-driven tests ─────────────────────────────────────────

type Handler = (event: any, ctx: any) => unknown;

function harness(mode: "tui" | "rpc" = "tui") {
  const handlers = new Map<string, Handler>();
  const messages: string[] = [];
  const notices: Array<[string, string | undefined]> = [];
  const indicators: unknown[] = [];
  const pi = {
    on: (name: string, fn: Handler) => void handlers.set(name, fn),
    getThinkingLevel: () => "high",
    registerCommand: () => {},
  };
  const ctx = {
    mode,
    hasUI: true,
    signal: undefined as { aborted: boolean } | undefined,
    ui: {
      theme: { getColorMode: () => "truecolor" },
      setWorkingMessage: (m?: string) => void (m !== undefined && messages.push(m)),
      setWorkingIndicator: (o?: unknown) => void indicators.push(o),
      notify: (m: string, t?: string) => void notices.push([m, t]),
    },
  };
  claudeShimmer(pi as never);
  const emit = async (name: string, event: Record<string, unknown> = {}) => {
    await handlers.get(name)?.({ type: name, ...event }, ctx);
  };
  const last = () => strip(messages.at(-1) ?? "");
  return { emit, messages, notices, indicators, ctx, last };
}

const assistant = (text: string, extra: Record<string, unknown> = {}) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  ...extra,
});

async function streamText(h: ReturnType<typeof harness>, text: string, usageOutput = 1) {
  const message = assistant("", { usage: { output: usageOutput, input: 100 } });
  await h.emit("message_start", { message });
  await h.emit("message_update", { message, assistantMessageEvent: { type: "start" } });
  await h.emit("message_update", { message, assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  await h.emit("message_update", { message, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } });
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
});

afterEach(async () => {
  mock.timers.reset();
  setColorMode("truecolor");
});

test("live counter is not stuck at 1 token on Anthropic-style stub usage", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.emit("agent_start");
  await h.emit("turn_start");
  await streamText(h, "abcd".repeat(500), 1); // ≈500 tokens, provider says 1
  mock.timers.tick(TICK_MS * 30);
  assert.match(h.last(), /↓ ~500 tokens/);

  // Tool round: final usage is authoritative and accumulates.
  await h.emit("message_end", { message: assistant("abcd".repeat(500), { usage: { output: 480, input: 100 }, stopReason: "toolUse" }) });
  assert.match(h.last(), /480 tokens/);
  assert.doesNotMatch(h.last(), /~480/);
  await h.emit("turn_end");
  await h.emit("turn_start");
  await streamText(h, "abcd".repeat(100), 1);
  await h.emit("message_end", { message: assistant("abcd".repeat(100), { usage: { output: 90, input: 100 }, stopReason: "stop" }) });
  assert.match(h.last(), /570 tokens/);
  await h.emit("session_shutdown");
});

test("aborted message keeps the larger estimate instead of dropping to 1", async () => {
  const h = harness();
  await h.emit("agent_start");
  await streamText(h, "abcd".repeat(2000), 1);
  await h.emit("message_end", { message: assistant("abcd".repeat(2000), { usage: { output: 1, input: 100 }, stopReason: "aborted" }) });
  assert.match(h.last(), /~2k tokens/);
  await h.emit("session_shutdown");
});

test("verb is picked once per run and stays across tool rounds", async () => {
  const h = harness();
  await h.emit("agent_start");
  const verbOf = () => /^\S+ (\p{L}[\p{L}'-]*)/u.exec(h.last())?.[1];
  const first = verbOf();
  assert.ok(first && (VERBS as readonly string[]).includes(first));
  for (let round = 0; round < 8; round++) {
    await h.emit("tool_execution_start");
    await h.emit("tool_execution_end");
    await h.emit("turn_end");
    await h.emit("turn_start");
    mock.timers.tick(TICK_MS);
    assert.equal(verbOf(), first);
  }
  await h.emit("session_shutdown");
});

test("completion notice uses whole-run time, fires once, only on success, at agent_settled", async () => {
  const h = harness();
  await h.emit("agent_start");
  await h.emit("turn_start");
  mock.timers.tick(4_000);
  await h.emit("message_end", { message: assistant("hi", { usage: { output: 5, input: 1 }, stopReason: "toolUse" }) });
  await h.emit("turn_end");
  await h.emit("turn_start");
  mock.timers.tick(3_000);
  await h.emit("message_end", { message: assistant("done", { usage: { output: 5, input: 1 }, stopReason: "stop" }) });
  await h.emit("agent_end", { messages: [assistant("done", { stopReason: "stop" })] });
  assert.equal(h.notices.length, 0, "agent_end must not announce (retries/compaction may follow)");
  await h.emit("agent_settled");
  await h.emit("agent_settled");
  assert.equal(h.notices.length, 1);
  const [text, type] = h.notices[0]!;
  assert.equal(type, "info");
  assert.match(strip(text), /^✻ \w+ for 7s$/);
});

test("no completion notice after Esc or error", async () => {
  for (const stopReason of ["aborted", "error"]) {
    const h = harness();
    await h.emit("agent_start");
    await h.emit("message_end", { message: assistant("partial", { stopReason }) });
    await h.emit("agent_end", { messages: [assistant("partial", { stopReason })] });
    await h.emit("agent_settled");
    assert.equal(h.notices.length, 0, stopReason);
  }
  // Abort during tool execution: last assistant message was a toolUse, but the signal is aborted.
  const h = harness();
  await h.emit("agent_start");
  await h.emit("message_end", { message: assistant("call", { stopReason: "toolUse" }) });
  h.ctx.signal = { aborted: true };
  await h.emit("agent_end", { messages: [] });
  await h.emit("agent_settled");
  assert.equal(h.notices.length, 0);
});

test("retry after error keeps the run and announces success once", async () => {
  const h = harness();
  await h.emit("agent_start");
  await h.emit("message_end", { message: assistant("", { stopReason: "error" }) });
  await h.emit("agent_end", { messages: [assistant("", { stopReason: "error" })] });
  await h.emit("agent_start");
  await h.emit("message_end", { message: assistant("ok", { usage: { output: 2, input: 1 }, stopReason: "stop" }) });
  await h.emit("agent_end", { messages: [assistant("ok", { stopReason: "stop" })] });
  await h.emit("agent_settled");
  assert.equal(h.notices.length, 1);
});

test("non-TUI modes: no animation, no ANSI notify", async () => {
  const h = harness("rpc");
  await h.emit("session_start");
  await h.emit("agent_start");
  await streamText(h, "hello");
  mock.timers.tick(TICK_MS * 5);
  await h.emit("message_end", { message: assistant("hello", { stopReason: "stop" }) });
  await h.emit("agent_end", { messages: [] });
  await h.emit("agent_settled");
  assert.equal(h.messages.length, 0);
  assert.equal(h.indicators.length, 0);
  assert.equal(h.notices.length, 0);
});

test("single clock: indicator hidden, message updates once per tick", async () => {
  const h = harness();
  await h.emit("agent_start");
  assert.deepEqual(h.indicators[0], { frames: [], intervalMs: TICK_MS });
  const before = h.messages.length;
  mock.timers.tick(TICK_MS * 10);
  assert.equal(h.messages.length - before, 10);
  await h.emit("agent_end", { messages: [] });
  const stopped = h.messages.length;
  mock.timers.tick(TICK_MS * 10);
  assert.equal(h.messages.length, stopped, "no ticks after agent_end");
  await h.emit("agent_settled");
  assert.equal(h.indicators.at(-1), undefined, "indicator restored to Pi default");
});

test("disposed UI mid-tick stops the clock instead of throwing", async () => {
  const h = harness();
  await h.emit("agent_start");
  let calls = 0;
  h.ctx.ui.setWorkingMessage = () => {
    calls++;
    throw new Error("disposed");
  };
  mock.timers.tick(TICK_MS * 5);
  assert.equal(calls, 1);
});

test("stall fades the verb toward coral after ~3s without stream updates", async () => {
  const h = harness();
  await h.emit("agent_start");
  await streamText(h, "hello");
  mock.timers.tick(TICK_MS);
  const fresh = h.messages.at(-1)!;
  mock.timers.tick(6_000);
  const stalled = h.messages.at(-1)!;
  // Fully stalled: every verb char is pulled to coral (255;143;163) or its bloom.
  const reds = (s: string) => [...s.matchAll(/38;2;(\d+);/g)].filter((m) => Number(m[1]) === 255).length;
  assert.ok(reds(stalled) > reds(fresh));
  await h.emit("session_shutdown");
});
