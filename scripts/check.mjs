import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

assert.equal(manifest.name, "pi-sakura-cyberdeck");
assert.equal(manifest.keywords.includes("pi-package"), true);

for (const path of [...manifest.pi.extensions, ...manifest.pi.themes]) {
  await access(resolve(root, path));
}

const theme = JSON.parse(await readFile(resolve(root, "themes/sakura-macaron.json"), "utf8"));
const requiredColors = [
  "accent", "border", "borderAccent", "borderMuted", "success", "error", "warning",
  "muted", "dim", "text", "thinkingText", "selectedBg", "userMessageBg",
  "userMessageText", "customMessageBg", "customMessageText", "customMessageLabel",
  "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput", "mdHeading",
  "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote",
  "mdQuoteBorder", "mdHr", "mdListBullet", "toolDiffAdded", "toolDiffRemoved",
  "toolDiffContext", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
  "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh",
  "thinkingXhigh", "bashMode",
];

assert.equal(theme.name, "sakura-macaron");
for (const color of requiredColors) assert.ok(color in theme.colors, `missing theme color: ${color}`);

// Fixed-editor regression: when pinned cluster shrinks, rows above its new start
// belong to transcript. paintCluster runs after transcript output and must not clear them.
const compositor = await readFile(
  resolve(root, "extensions/zentui/fixed-editor/compositor.ts"),
  "utf8",
);
assert.match(compositor, /const clearStart = startRow;/);
assert.doesNotMatch(
  compositor,
  /const clearStart = previous \? Math\.min\(previous\.startRow, startRow\)/,
);
const previousCluster = { startRow: 34, lineCount: 7 };
const nextCluster = { startRow: 37, lineCount: 4 };
const clearEnd = Math.max(
  previousCluster.startRow + previousCluster.lineCount - 1,
  nextCluster.startRow + nextCluster.lineCount - 1,
);
const postPaintClears = Array.from(
  { length: clearEnd - nextCluster.startRow + 1 },
  (_, index) => nextCluster.startRow + index,
);
assert.deepEqual(postPaintClears, [37, 38, 39, 40]);
assert.equal(postPaintClears.some((row) => row >= 34 && row <= 36), false);

// Mouse ownership: transcript events stay here; fresh cluster clicks pass to widgets.
assert.match(compositor, /mouseEv && this\.handleMouseEvent\(mouseEv\)/);
assert.match(compositor, /if \(!this\.selection\.isDragging\) return false;/);
assert.match(compositor, /if \(ev\.action === "release"\) \{\s*this\.selection\.clear\(\);/);

// HUD keeps one useful clock: total turn time, not a transient duplicate thought timer.
const shimmer = await readFile(resolve(root, "extensions/claude-shimmer/index.ts"), "utf8");
assert.doesNotMatch(shimmer, /thinkingDuration|THOUGHT_DISPLAY_MS|thoughtTimer/);
assert.match(shimmer, /parts\.push\(rgbAnsi\(MUTED, formatDigital\(elapsed\)\)\)/);

console.log("pi-sakura-cyberdeck package check passed");
