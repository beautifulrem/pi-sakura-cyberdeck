import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultConfig } from "../extensions/zentui/config";
import {
	FIXED_EDITOR_REMOVED_MESSAGE,
	parseDirectCommand,
	parseFormatCommand,
	registerZentuiSettingsCommand,
	usageText,
} from "../extensions/zentui/settings-command";

test("direct commands require an exact target and action", () => {
	assert.deepEqual(parseDirectCommand("editor disable", defaultConfig), {
		kind: "feature",
		feature: "editor",
		enabled: false,
	});
	assert.deepEqual(parseDirectCommand("  StatusLine   OFF ", defaultConfig), {
		kind: "feature",
		feature: "statusLine",
		enabled: false,
	});
	assert.deepEqual(parseDirectCommand("messages toggle", defaultConfig), {
		kind: "feature",
		feature: "messageStyle",
		enabled: !defaultConfig.features.messageStyle,
	});
	assert.deepEqual(parseDirectCommand("pulse on", defaultConfig), {
		kind: "footerPulse",
		enabled: true,
	});
	for (const input of [
		"editor",
		"disable editor",
		"editor disable now",
		"the editor disable",
		"editor_disable",
		"my-editor off",
		"copy friendly off",
		"constructor on",
		"__proto__ off",
	]) {
		assert.deepEqual(parseDirectCommand(input, defaultConfig), { kind: "invalid" }, input);
	}
});

test("fixed-editor commands never touch the main editor", () => {
	for (const input of ["fixed-editor disable", "fixed-editor enable", "fixed_editor toggle", "fixededitor off"]) {
		const command = parseDirectCommand(input, defaultConfig);
		assert.notEqual(command.kind, "feature", input);
	}
	assert.equal(parseDirectCommand("fixed-editor disable", defaultConfig).kind, "removed");
});

test("/zentui fixed-editor disable notifies instead of disabling the editor", async () => {
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	const pi = {
		registerCommand(_name: string, options: { handler: typeof handler }) {
			handler = options.handler;
		},
	};
	const calls: string[] = [];
	const notices: string[] = [];
	const unexpected = (name: string) => () => {
		calls.push(name);
		return { applied: true };
	};
	registerZentuiSettingsCommand(pi as never, {
		sessionLifecycle: {} as never,
		getConfig: () => defaultConfig,
		setColorSources: unexpected("setColorSources"),
		setUiFeatures: unexpected("setUiFeatures"),
		setFooterSegments: unexpected("setFooterSegments"),
		setFooterFormat: unexpected("setFooterFormat"),
		setIconMode: unexpected("setIconMode"),
		setContextStyle: unexpected("setContextStyle"),
		setSeparator: unexpected("setSeparator"),
		setPathDisplay: unexpected("setPathDisplay"),
		setGitBranch: unexpected("setGitBranch"),
		getActiveExtensionStatuses: () => new Map(),
		setExtensionStatusPlacement: unexpected("setExtensionStatusPlacement"),
		setExtensionStatusColorMode: unexpected("setExtensionStatusColorMode"),
		setAnimations: unexpected("setAnimations"),
		requestRender: () => {},
	});
	const ctx = { hasUI: true, mode: "tui", ui: { notify: (message: string) => notices.push(message) } };
	assert.ok(handler);
	await handler("fixed-editor disable", ctx);
	await handler("editor please", ctx);
	assert.deepEqual(calls, []);
	assert.deepEqual(notices, [FIXED_EDITOR_REMOVED_MESSAGE, usageText()]);
	await handler("editor off", ctx);
	assert.deepEqual(calls, ["setUiFeatures"]);
});

test("format command needs the exact `format` keyword", () => {
	assert.deepEqual(parseFormatCommand('format "$cwd $fill $context"'), { value: "$cwd $fill $context" });
	assert.deepEqual(parseFormatCommand("format clear"), { value: undefined });
	assert.deepEqual(parseFormatCommand("format"), { value: undefined });
	assert.equal(parseFormatCommand("formatting on"), undefined);
});
