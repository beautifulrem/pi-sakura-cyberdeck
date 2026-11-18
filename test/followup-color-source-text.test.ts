import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { getColorMode, setColorMode } from "../extensions/shared/color";
import { defaultConfig } from "../extensions/zentui/config";
import { SAKURA_MACARON_GRADIENT } from "../extensions/zentui/gradient";
import { registerZentuiSettingsCommand } from "../extensions/zentui/settings-command";
import { renderStyleForSource } from "../extensions/zentui/style";

const identity = (text: string) => text;
const markerTheme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>`, bold: identity, italic: identity, underline: identity };

test("the theme colour source leaves hex colours alone and maps named colours", () => {
	const previous = getColorMode();
	setColorMode("truecolor");
	try {
		const hexDefaults = Object.entries(defaultConfig.colors).filter(([, spec]) => spec && spec !== SAKURA_MACARON_GRADIENT);
		assert.ok(hexDefaults.length > 20);
		for (const [key, spec] of hexDefaults) {
			assert.match(spec!, /#[0-9A-F]{6}/i, `${key} default is a hex colour`);
			assert.equal(
				renderStyleForSource(markerTheme, "theme", spec!, "x"),
				renderStyleForSource(markerTheme, "terminal", spec!, "x"),
				`${key}: hex default looks the same in both sources`,
			);
		}
		assert.equal(renderStyleForSource(markerTheme, "theme", "green", "x"), "<success>x</success>");
		assert.notEqual(renderStyleForSource(markerTheme, "terminal", "green", "x"), "<success>x</success>");
		// Built-in runtime styles are named, so they do follow the theme.
		assert.equal(renderStyleForSource(markerTheme, "theme", "bold green", "x"), "<success>x</success>");
		// Theme tokens such as accent resolve through the theme in both sources.
		assert.equal(renderStyleForSource(markerTheme, "terminal", "accent", "x"), "<accent>x</accent>");
	} finally {
		setColorMode(previous);
	}
});

async function colorDescriptions(): Promise<string[]> {
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	const pi = { registerCommand: (_name: string, options: { handler: typeof handler }) => { handler = options.handler; } };
	const noop = () => ({ applied: true });
	const listTheme = { label: identity, value: identity, description: identity, cursor: "> ", hint: identity };
	registerZentuiSettingsCommand(pi as never, {
		sessionLifecycle: {} as never,
		getConfig: () => defaultConfig,
		setColorSources: noop, setUiFeatures: noop, setFooterSegments: noop, setFooterFormat: noop,
		setIconMode: noop, setContextStyle: noop, setSeparator: noop, setPathDisplay: noop, setGitBranch: noop,
		getActiveExtensionStatuses: () => new Map(),
		setExtensionStatusPlacement: noop, setExtensionStatusColorMode: noop, setAnimations: noop,
		requestRender: () => {},
		settingsListTheme: listTheme as never,
	});
	const screens: string[] = [];
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			notify() {},
			custom: async (factory: (...args: unknown[]) => { render(width: number): string[]; handleInput?(data: string): void }) => {
				let finished = false;
				const component = factory({ requestRender() {}, invalidate() {} }, markerTheme, {}, () => { finished = true; });
				screens.push(stripVTControlCharacters(component.render(200).join("\n")));
				component.handleInput?.("\x1b[B");
				screens.push(stripVTControlCharacters(component.render(200).join("\n")));
				return finished ? undefined : undefined;
			},
		},
	};
	await handler!("", ctx);
	return screens;
}

test("colour-source descriptions say hex defaults are not remapped", async () => {
	const [starship, editor] = await colorDescriptions();
	assert.ok(starship && editor);
	for (const screen of [starship, editor]) {
		assert.match(screen, /hex/i, screen);
		assert.match(screen, /named/i, screen);
	}
	assert.match(editor!, /rail/i, "the sent-message rail follows the theme");
	assert.match(editor!, /gradient/i, "Sakura gradient borders are kept");
});
