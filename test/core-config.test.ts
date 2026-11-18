import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, saveUiFeaturesPatch } from "../extensions/zentui/config";

function tempConfig(content?: unknown): string {
	const path = join(mkdtempSync(join(tmpdir(), "zentui-core-config-")), "zentui.json");
	if (content !== undefined) writeFileSync(path, JSON.stringify(content));
	return path;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("disabling the editor in a fresh config keeps message styling on", () => {
	for (const path of [tempConfig(), tempConfig({}), tempConfig({ features: {} })]) {
		const saved = saveUiFeaturesPatch({ editor: false }, path);
		assert.equal(saved.features.editor, false);
		assert.equal(saved.features.messageStyle, true, "messageStyle is independent of the editor");
		assert.equal(loadConfig(path).features.messageStyle, true, "and survives a reload");
		assert.equal(readJson(path).features.messageStyle, true, "pinned in the saved file");
	}
});

test("legacy configs without messageStyle keep their resolved look when saved", () => {
	// ≤1.1.6: editor off meant message styling off; an unrelated save must not change that.
	const legacy = tempConfig({ features: { editor: false } });
	assert.equal(loadConfig(legacy).features.messageStyle, false);
	const saved = saveUiFeaturesPatch({ copyFriendly: true }, legacy);
	assert.equal(saved.features.messageStyle, false);
	assert.deepEqual(readJson(legacy).features, { editor: false, messageStyle: false, copyFriendly: true });

	// Re-enabling the editor no longer drags message styling with it.
	assert.equal(saveUiFeaturesPatch({ editor: true }, legacy).features.messageStyle, false);

	// An explicit messageStyle in the patch always wins.
	const explicit = tempConfig({ features: { editor: false } });
	assert.equal(saveUiFeaturesPatch({ messageStyle: true }, explicit).features.messageStyle, true);
	const kept = tempConfig({ features: { messageStyle: false } });
	assert.equal(saveUiFeaturesPatch({ editor: true }, kept).features.messageStyle, false);
});
