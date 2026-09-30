import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfigWithDiagnostics, mergeConfig, removeLegacyFixedEditorConfig } from "../extensions/zentui/config";
import { parseFormatCommand } from "../extensions/zentui/settings-command";
import { loadConfig as loadMatrixConfig, saveConfig as saveMatrixConfig } from "../extensions/matrix/index";

test("≤1.1.6 configs with the editor off keep stock message styling", () => {
	assert.equal(mergeConfig({ features: { editor: false } }).features.messageStyle, false);
	assert.equal(mergeConfig({ features: { editor: true } }).features.messageStyle, true);
	assert.equal(mergeConfig({}).features.messageStyle, true);
	assert.equal(mergeConfig({ features: { editor: false, messageStyle: true } }).features.messageStyle, true);
});

test("any legacy fixedEditor block is detected and removable; notice only when it was enabled", () => {
	const dir = mkdtempSync(join(tmpdir(), "zentui-legacy-"));
	const path = join(dir, "config.json");
	writeFileSync(path, JSON.stringify({ fixedEditor: { enabled: false }, colors: { cost: "mdCode" } }));
	const loaded = loadConfigWithDiagnostics(path);
	assert.equal(loaded.hasLegacyFixedEditor, true);
	assert.equal(loaded.legacyFixedEditorEnabled, false);
	removeLegacyFixedEditorConfig(path);
	const after = JSON.parse(readFileSync(path, "utf8"));
	assert.equal("fixedEditor" in after, false);
	assert.equal(after.colors.cost, "mdCode");
});

test('/zentui format "" clears the format', () => {
	assert.deepEqual(parseFormatCommand('format ""'), { value: undefined });
	assert.deepEqual(parseFormatCommand("format clear"), { value: undefined });
	assert.deepEqual(parseFormatCommand('format "$cwd"'), { value: "$cwd" });
});

test("matrix config writes atomically and round-trips", () => {
	const dir = mkdtempSync(join(tmpdir(), "matrix-"));
	const path = join(dir, "sub", "matrix.json");
	const config = { ...loadMatrixConfig(join(dir, "missing.json")).config, enabled: true, fps: 12 };
	assert.equal(saveMatrixConfig(config, path), undefined);
	assert.equal(loadMatrixConfig(path).config.fps, 12);
	assert.equal(loadMatrixConfig(path).config.enabled, true);
});
