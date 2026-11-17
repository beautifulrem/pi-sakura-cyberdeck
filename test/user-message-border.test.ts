import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { initTheme, Theme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { getColorMode, setColorMode } from "../extensions/shared/color";
import { mergeConfig } from "../extensions/zentui/config";
import { renderSakuraFrameGradient } from "../extensions/zentui/gradient";
import { installUserMessageStyle } from "../extensions/zentui/user-message";

initTheme("dark");
const shipped = JSON.parse(readFileSync(new URL("../themes/sakura-macaron.json", import.meta.url), "utf8"));
const colors = Object.fromEntries(Object.entries(shipped.colors as Record<string, string>)
	.map(([role, value]) => [role, shipped.vars[value] ?? value]));

test("sent prompts keep Sakura gradient borders with the default real theme and both color sources", () => {
	const previous = getColorMode();
	let config = mergeConfig({});
	assert.equal(config.colorSources.userMessages, "theme", "exercise the default that regressed in 1.5.0");
	let theme = new Theme(colors as never, colors as never, "truecolor");
	const cleanup = installUserMessageStyle(() => theme, () => config);
	try {
		const message = new UserMessageComponent("目前有一个问题，就是发出问题后，边框渐变变暗了。");
		for (const mode of ["truecolor", "256color", "none"] as const) {
			setColorMode(mode);
			theme = new Theme(colors as never, colors as never, mode === "none" ? "truecolor" : mode);
			for (const source of ["theme", "terminal"] as const) {
				config = mergeConfig({ colorSources: { userMessages: source } });
				for (const width of [32, 80, 172]) {
					const frame = message.render(width);
					const expected = renderSakuraFrameGradient("─".repeat(width));
					assert.equal(frame[0], expected, `${mode}/${source}/${width}: top border`);
					assert.equal(frame.at(-1), expected, `${mode}/${source}/${width}: bottom border`);
					assert.equal(message.render(width), frame, "unchanged frame stays cached");
					message.invalidate();
					assert.equal(message.render(width)[0], expected, "native invalidation preserves the gradient");
					if (mode !== "none") {
						assert.notEqual(frame[0], theme.fg("borderMuted", "─".repeat(width)), "never replace the brand gradient with a dim semantic border");
					}
				}
			}
		}
	} finally {
		cleanup();
		setColorMode(previous);
	}
});
