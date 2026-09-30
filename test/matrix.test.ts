import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  createDrops,
  DEFAULT_CONFIG,
  describeConfig,
  loadConfig,
  normalizeConfig,
  parseMatrixCommand,
  renderSakuraMatrix,
  saveConfig,
} from "../extensions/matrix/index";

test("matrix is opt-in by default", () => {
  assert.equal(DEFAULT_CONFIG.enabled, false);
  assert.equal(normalizeConfig({}).enabled, false);
  // Existing users keep their saved choice.
  assert.equal(normalizeConfig({ enabled: true }).enabled, true);
});

test("config values are clamped and invalid fields fall back to defaults", () => {
  assert.deepEqual(normalizeConfig({ enabled: "yes", fps: 99, density: 0.1, height: 42 }), {
    enabled: false,
    fps: 18,
    density: 0.45,
    height: 6,
  });
  assert.deepEqual(normalizeConfig({ fps: "abc", density: null, height: -1 }), { ...DEFAULT_CONFIG });
  assert.deepEqual(normalizeConfig("garbage"), { ...DEFAULT_CONFIG });
  assert.equal(normalizeConfig({ fps: 12.6 }).fps, 13);
});

test("subcommand parsing", () => {
  assert.deepEqual(parseMatrixCommand(""), { type: "status" });
  assert.deepEqual(parseMatrixCommand("  STATUS "), { type: "status" });
  assert.deepEqual(parseMatrixCommand("help"), { type: "help" });
  assert.deepEqual(parseMatrixCommand("on"), { type: "on" });
  assert.deepEqual(parseMatrixCommand("off"), { type: "off" });
  assert.deepEqual(parseMatrixCommand("preview"), { type: "preview" });
  assert.deepEqual(parseMatrixCommand("fps 12"), { type: "set", key: "fps", value: 12 });
  assert.deepEqual(parseMatrixCommand("density 0.777"), { type: "set", key: "density", value: 0.78 });
  assert.deepEqual(parseMatrixCommand("height 5"), { type: "set", key: "height", value: 5 });
  for (const bad of ["fps", "fps 2", "fps x", "density 1.5", "height 9", "wat"]) {
    assert.equal(parseMatrixCommand(bad).type, "invalid", bad);
  }
  const unknown = parseMatrixCommand("wat");
  assert.ok(unknown.type === "invalid" && unknown.message.includes("/sakura-matrix height N"));
});

test("load/save report errors instead of throwing or silently resetting", () => {
  const dir = mkdtempSync(join(tmpdir(), "sakura-matrix-"));
  try {
    const path = join(dir, "matrix.json");
    assert.deepEqual(loadConfig(path), { config: { ...DEFAULT_CONFIG } });

    writeFileSync(path, "{ not json", "utf8");
    const broken = loadConfig(path);
    assert.deepEqual(broken.config, { ...DEFAULT_CONFIG });
    assert.ok(broken.error);
    assert.equal(readFileSync(path, "utf8"), "{ not json", "loading never rewrites the user's file");

    const config = { enabled: true, fps: 12, density: 0.5, height: 5 };
    assert.equal(saveConfig(config, path), undefined);
    assert.deepEqual(loadConfig(path).config, config);

    // Writing into a path whose parent is a file fails → error string, no throw.
    assert.equal(typeof saveConfig(config, join(path, "nested.json")), "string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rendered rows fit the width and match the configured height", () => {
  for (const width of [1, 7, 40, 213]) {
    const drops = createDrops(width, 0.65, 4);
    const lines = renderSakuraMatrix(width, 4, 1.3, "working", drops);
    assert.equal(lines.length, 4);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}`);
  }
});

test("describeConfig summarizes state", () => {
  assert.equal(describeConfig({ ...DEFAULT_CONFIG }), "Sakura Matrix: off · 10 FPS · 4 lines · density 0.65");
});

test("extension never touches Pi's working message/indicator and only animates in TUI", async () => {
  const { default: matrix } = await import("../extensions/matrix/index");
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
  const calls: string[] = [];
  const pi = {
    on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => void handlers.set(name, fn),
    registerCommand: (_name: string, options: typeof command) => void (command = options),
  };
  const ui = {
    theme: { getColorMode: () => "truecolor" },
    setWorkingMessage: () => calls.push("setWorkingMessage"),
    setWorkingIndicator: () => calls.push("setWorkingIndicator"),
    setWorkingVisible: () => calls.push("setWorkingVisible"),
    setWidget: (_key: string, content: unknown) => calls.push(content ? "widget:on" : "widget:off"),
    notify: (message: string) => calls.push(`notify:${message}`),
  };
  matrix(pi as never);
  const rpc = { mode: "rpc", hasUI: true, ui, isIdle: () => true };
  const tui = { mode: "tui", hasUI: true, ui, isIdle: () => true };

  await command!.handler("preview", rpc);
  assert.ok(calls.some((c) => c.startsWith("notify:") && c.includes("needs the interactive")));
  assert.ok(!calls.includes("widget:on"));

  await command!.handler("preview", tui);
  assert.ok(calls.includes("widget:on"));
  await handlers.get("agent_end")!({ type: "agent_end", messages: [] }, tui);
  assert.equal(calls.at(-1), "widget:off");

  await command!.handler("status", tui);
  await command!.handler("fps 99", tui);
  assert.ok(calls.at(-1)!.includes("Usage: /sakura-matrix fps <8-18>"));
  assert.ok(!calls.some((c) => c.startsWith("setWorking")));
});
