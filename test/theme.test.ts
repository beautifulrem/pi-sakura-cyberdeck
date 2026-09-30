import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const THEME_URL = new URL("../themes/sakura-macaron.json", import.meta.url);
const SCHEMA_PATH = "dist/modes/interactive/theme/theme-schema.json";
const SCHEMAS = [
  { label: "Pi 0.99.1 (.dev)", url: new URL(`../.dev/node_modules/@earendil-works/pi-coding-agent/${SCHEMA_PATH}`, import.meta.url) },
  { label: "Pi 0.87.1 (/tmp/pi-compat-087)", url: new URL(`file:///tmp/pi-compat-087/node_modules/@earendil-works/pi-coding-agent/${SCHEMA_PATH}`) },
];
const PACK_BG = "#14111A";
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

type ColorValue = string | number;
interface ThemeJson {
  name: string;
  vars?: Record<string, ColorValue>;
  colors: Record<string, ColorValue>;
  export?: Record<string, ColorValue>;
  [key: string]: unknown;
}
interface Schema {
  properties: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
  required?: string[];
}

const theme = JSON.parse(readFileSync(THEME_URL, "utf8")) as ThemeJson;

function resolve(value: ColorValue, vars: Record<string, ColorValue>, seen = new Set<string>()): ColorValue {
  if (typeof value === "number" || value === "" || value.startsWith("#")) return value;
  assert.ok(!seen.has(value), `circular var reference: ${value}`);
  assert.ok(value in vars, `unknown var reference: ${value}`);
  seen.add(value);
  return resolve(vars[value]!, vars, seen);
}

function checkValue(where: string, value: ColorValue): void {
  if (typeof value === "number") {
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 255, `${where}: 256-color index out of range`);
    return;
  }
  assert.equal(typeof value, "string", `${where}: must be a string or integer`);
  if (value === "" || !value.startsWith("#")) return; // terminal default or var reference (resolved separately)
  assert.match(value, HEX, `${where}: invalid hex ${value}`);
}

function validate(schema: Schema): void {
  const allowedTop = Object.keys(schema.properties);
  for (const key of Object.keys(theme)) assert.ok(allowedTop.includes(key), `top-level key "${key}" not allowed`);
  for (const key of schema.required ?? []) assert.ok(key in theme, `missing top-level "${key}"`);

  const colorSchema = schema.properties.colors!;
  const allowedColors = Object.keys(colorSchema.properties ?? {});
  for (const key of colorSchema.required ?? []) assert.ok(key in theme.colors, `missing required color "${key}"`);
  for (const key of Object.keys(theme.colors)) assert.ok(allowedColors.includes(key), `color "${key}" not in schema`);

  const allowedExport = Object.keys(schema.properties.export?.properties ?? {});
  for (const key of Object.keys(theme.export ?? {})) assert.ok(allowedExport.includes(key), `export "${key}" not in schema`);

  const vars = theme.vars ?? {};
  for (const [key, value] of Object.entries(vars)) checkValue(`vars.${key}`, value);
  for (const section of ["colors", "export"] as const) {
    for (const [key, value] of Object.entries(theme[section] ?? {})) {
      checkValue(`${section}.${key}`, value);
      checkValue(`${section}.${key} (resolved)`, resolve(value, vars));
    }
  }
}

for (const { label, url } of SCHEMAS) {
  test(`theme validates against ${label} schema`, (t) => {
    if (!existsSync(url)) {
      t.skip(`schema not found at ${url.pathname}`);
      return;
    }
    validate(JSON.parse(readFileSync(url, "utf8")) as Schema);
  });
}

test("theme defines the optional scrollbar/search colors and no unused vars", () => {
  for (const key of ["scrollbarTrack", "scrollbarThumb", "searchMatchBg", "searchMatchText"]) {
    assert.ok(key in theme.colors, key);
  }
  const used = new Set<string>();
  const vars = theme.vars ?? {};
  const visit = (value: ColorValue) => {
    if (typeof value === "string" && value in vars && !used.has(value)) {
      used.add(value);
      visit(vars[value]!);
    }
  };
  for (const value of [...Object.values(theme.colors), ...Object.values(theme.export ?? {})]) visit(value);
  const unused = Object.keys(vars).filter((name) => !used.has(name));
  assert.deepEqual(unused, []);
});

function luminance(hex: string): number {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  const n = Number.parseInt(full.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("text, muted and dim meet WCAG AA (4.5:1) on the pack background; borders ≥ 2:1", () => {
  const vars = theme.vars ?? {};
  const color = (key: string) => String(resolve(theme.colors[key]!, vars));
  for (const key of ["text", "muted", "dim", "thinkingText", "toolOutput"]) {
    const ratio = contrast(color(key), PACK_BG);
    assert.ok(ratio >= 4.5, `${key} ${color(key)}: ${ratio.toFixed(2)}:1`);
  }
  for (const key of ["border", "borderMuted"]) {
    const ratio = contrast(color(key), PACK_BG);
    assert.ok(ratio >= 2, `${key} ${color(key)}: ${ratio.toFixed(2)}:1`);
  }
  const search = contrast(color("searchMatchText"), color("searchMatchBg"));
  assert.ok(search >= 4.5, `search match ${search.toFixed(2)}:1`);
});
