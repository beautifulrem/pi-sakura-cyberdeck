import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	defaultConfig,
	getExtensionStatusColorMode,
	getExtensionStatusPlacement,
	loadConfigWithDiagnostics,
	mergeConfig,
	removeLegacyFixedEditorConfig,
	saveAnimationsPatch,
	saveExtensionStatusPlacement,
	saveUiFeaturesPatch,
} from "../extensions/zentui/config";

function tempConfig(content?: string): string {
	const path = join(mkdtempSync(join(tmpdir(), "zentui-config-")), "zentui.json");
	if (content !== undefined) writeFileSync(path, content);
	return path;
}

test("defaults have a single source of truth", () => {
	assert.deepEqual(mergeConfig({}), defaultConfig);
	assert.deepEqual(mergeConfig(undefined), defaultConfig);
	assert.equal(defaultConfig.projectRefreshIntervalMs, 60_000);
	assert.equal(defaultConfig.footerFormat, "");
	assert.equal(defaultConfig.icons.mode, "auto");
	assert.equal(defaultConfig.icons.rail, "▐");
	assert.equal(defaultConfig.icons.editorPrompt, "\u{f0734}");
	assert.equal(defaultConfig.animations.footerPulse, false);
	assert.equal(defaultConfig.features.messageStyle, true);
	assert.equal(defaultConfig.colors.editorThinkingMax, "bold #FF8FA3");
	const ascii = mergeConfig({ icons: { mode: "ascii" } });
	assert.equal(ascii.icons.rail, "|");
	assert.equal(ascii.icons.editorPrompt, ">");
});

test("old configs with fixedEditor still load; the key is ignored", () => {
	const path = tempConfig(JSON.stringify({ fixedEditor: { enabled: true, mouseScroll: false }, separator: "dot" }));
	const loaded = loadConfigWithDiagnostics(path);
	assert.equal(loaded.problem, undefined);
	assert.equal(loaded.legacyFixedEditorEnabled, true);
	assert.equal(loaded.config.separator, "dot");
	assert.equal("fixedEditor" in loaded.config, false);
	removeLegacyFixedEditorConfig(path);
	const after = JSON.parse(readFileSync(path, "utf8"));
	assert.deepEqual(after, { separator: "dot" });
	assert.equal(loadConfigWithDiagnostics(path).legacyFixedEditorEnabled, false);
});

test("corrupt config reports the file + error, uses defaults and refuses to save", () => {
	const path = tempConfig("{ not json");
	const loaded = loadConfigWithDiagnostics(path);
	assert.ok(loaded.problem?.startsWith(path));
	assert.match(loaded.problem ?? "", /JSON/);
	assert.deepEqual(loaded.config, defaultConfig);
	assert.throws(() => saveUiFeaturesPatch({ editor: false }, path), /Refusing to save/);
	assert.equal(readFileSync(path, "utf8"), "{ not json");

	const arrayPath = tempConfig("[]");
	assert.match(loadConfigWithDiagnostics(arrayPath).problem ?? "", /JSON object/);
});

test("missing config loads defaults without a problem; saves are atomic JSON", () => {
	const path = tempConfig();
	assert.deepEqual(loadConfigWithDiagnostics(path), {
		config: defaultConfig,
		legacyFixedEditorEnabled: false,
	});
	const saved = saveAnimationsPatch({ footerPulse: true }, path);
	assert.equal(saved.animations.footerPulse, true);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { animations: { footerPulse: true } });
});

test("extension status placements are own-property lookups (no prototype keys)", () => {
	const config = mergeConfig(
		JSON.parse(
			'{"extensionStatuses":{"placements":{"__proto__":"left","constructor":"middle","real":"off"}}}',
		),
	);
	assert.equal(getExtensionStatusPlacement(config, "constructor"), "middle");
	assert.equal(getExtensionStatusPlacement(config, "__proto__"), "left");
	assert.equal(getExtensionStatusPlacement(config, "toString"), "right");
	assert.equal(getExtensionStatusPlacement(config, "hasOwnProperty"), "right");
	assert.equal(getExtensionStatusColorMode(config, "constructor"), "zentui");
	assert.equal(getExtensionStatusColorMode(defaultConfig, "__proto__"), "zentui");
	assert.equal(getExtensionStatusPlacement(defaultConfig, "valueOf"), "right");

	const path = tempConfig("{}");
	const saved = saveExtensionStatusPlacement("__proto__", "off", path);
	assert.equal(getExtensionStatusPlacement(saved, "__proto__"), "off");
	assert.equal(getExtensionStatusPlacement(saved, "other"), "right");
});
