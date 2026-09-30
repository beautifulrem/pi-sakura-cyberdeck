import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import sakuraCyberdeckHeader, { renderHeader, TOP_PADDING } from "../extensions/header/index";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("every header line fits the terminal width, including very narrow ones", () => {
  for (const width of [1, 2, 5, 10, 21, 22, 40, 64, 65, 66, 80, 200]) {
    const lines = renderHeader(width);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${visibleWidth(line)}`);
  }
  assert.deepEqual(renderHeader(0), []);
  assert.deepEqual(renderHeader(-3), []);
});

test("header height is fixed (does not grow with terminal height)", () => {
  const heights = new Set([20, 40, 65, 120].map((w) => renderHeader(w).length));
  assert.equal(heights.size, 1);
  const lines = renderHeader(120);
  assert.equal(lines.slice(0, TOP_PADDING).every((l) => l === ""), true);
  assert.ok(TOP_PADDING <= 1);
  assert.ok(lines.length <= 14);
});

test("label truncates with an ellipsis at narrow widths", () => {
  const narrow = renderHeader(10).map(strip);
  assert.ok(narrow.some((l) => l.includes("…")));
  const wide = renderHeader(80).map(strip);
  assert.ok(wide.some((l) => l.includes("SAKURA CYBERDECK")));
});

test("header only installs in TUI mode", async () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  sakuraCyberdeckHeader({ on: (name: string, fn: never) => void handlers.set(name, fn) } as never);
  let installs = 0;
  const ui = { theme: { getColorMode: () => "truecolor" }, setHeader: (f: unknown) => void (f && installs++) };
  await handlers.get("session_start")!({}, { mode: "rpc", hasUI: true, ui });
  await handlers.get("session_start")!({}, { mode: "print", hasUI: false, ui });
  assert.equal(installs, 0);
  await handlers.get("session_start")!({}, { mode: "tui", hasUI: true, ui });
  assert.equal(installs, 1);
});
