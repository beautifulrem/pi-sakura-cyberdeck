import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderSakuraGradient } from "../extensions/zentui/gradient";

test("harness resolves Pi host packages and extensionless imports", () => {
	assert.equal(visibleWidth(renderSakuraGradient("sakura")), 6);
});
