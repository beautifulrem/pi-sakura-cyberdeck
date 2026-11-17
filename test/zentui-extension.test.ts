import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;

const agentDir = mkdtempSync(join(tmpdir(), "zentui-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const configFile = join(agentDir, "sakura-cyberdeck-zentui.json");

type Handler = (event: unknown, ctx: unknown) => unknown;

async function setup(getSettings?: () => unknown) {
	const { default: zentui } = await import("../extensions/zentui/index");
	const handlers = new Map<string, Handler[]>();
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand() {},
		getThinkingLevel: () => "off",
		...(getSettings ? { getSettings } : {}),
	};
	zentui(pi as never);
	const emit = async (event: string, payload: unknown, ctx: unknown) => {
		for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
	};
	return { emit };
}

function makeCtx() {
	const notices: string[] = [];
	let footerFactory: ((...args: unknown[]) => { render(width: number): string[]; dispose?(): void }) | undefined;
	let footer: { render(width: number): string[]; dispose?(): void } | undefined;
	let editorFactory: EditorFactory | undefined;
	const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t, getColorMode: () => "256color" };
	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: mkdtempSync(join(tmpdir(), "zentui-cwd-")),
		model: { provider: "openai", id: "gpt-5", contextWindow: 1000 },
		isProjectTrusted: () => false,
		getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
		sessionManager: {
			getEntries: () => [],
			getLeafId: () => "leaf",
			getSessionId: () => "s",
		},
		ui: {
			theme,
			notify: (message: string) => notices.push(message),
			setFooter(factory: typeof footerFactory) {
				footer?.dispose?.();
				footerFactory = factory;
				footer = factory?.(
					{ requestRender() {} },
					theme,
					{
						getGitBranch: () => "main\x1b]0;x\x07",
						getExtensionStatuses: () => new Map([["constructor", "status!"]]),
						onBranchChange: () => () => {},
					},
				);
			},
			setEditorComponent(factory: EditorFactory | undefined) {
				editorFactory = factory;
			},
			getEditorComponent: () => editorFactory,
		},
	};
	return { ctx, notices, footer: () => footer, footerFactory: () => footerFactory, editor: () => editorFactory };
}

test("session lifecycle: config diagnostics, footer render, idempotent shutdown", async () => {
	writeFileSync(configFile, "{ broken");
	const { emit } = await setup();
	const first = makeCtx();
	await emit("session_start", {}, first.ctx);
	assert.equal(first.notices.length, 1);
	assert.match(first.notices[0] ?? "", /config is invalid/);
	assert.ok(first.notices[0]?.includes(configFile));
	const line = first.footer()?.render(120)[0] ?? "";
	assert.match(line, /main/);
	assert.doesNotMatch(line, /\x07|\]0;/, "branch from Pi is sanitized");
	assert.match(line, /status!/, "status key `constructor` renders instead of crashing");
	assert.ok(first.editor(), "editor installed");

	await emit("session_shutdown", {}, first.ctx);
	assert.equal(first.footerFactory(), undefined);
	await emit("session_shutdown", {}, first.ctx);

	// Legacy fixed-editor config: one notice, then the dead key is migrated away.
	writeFileSync(configFile, JSON.stringify({ fixedEditor: { enabled: true }, separator: "dot" }));
	const second = makeCtx();
	await emit("session_start", {}, second.ctx);
	assert.equal(second.notices.length, 1);
	assert.match(second.notices[0] ?? "", /tuiMode/);
	assert.deepEqual(JSON.parse(readFileSync(configFile, "utf8")), { separator: "dot" });
	await emit("session_shutdown", {}, second.ctx);

	const third = makeCtx();
	await emit("session_start", {}, third.ctx);
	assert.deepEqual(third.notices, []);
	await emit("session_shutdown", {}, third.ctx);
});

test("later editors keep their behavior inside Zentui after startup and surface events", async (t) => {
	writeFileSync(configFile, "{}");
	const { emit } = await setup();
	const session = makeCtx();
	t.after(() => emit("session_shutdown", {}, session.ctx));
	t.mock.timers.enable({ apis: ["setTimeout"] });
	await emit("session_start", {}, session.ctx);
	assert.ok(session.editor(), "Zentui installs first");
	t.mock.timers.tick(0); // The old single-tick check has already run.
	t.mock.timers.tick(2000); // Startup may take longer than any fixed settle window.
	let text = "foreign editor body";
	const base = {
		borderColor: (value: string) => value,
		render(width: number) {
			const rule = this.borderColor("─".repeat(width));
			return [rule, text, rule, "@README completion"];
		},
		isShowingAutocomplete: () => true,
		invalidate() {},
		handleInput(data: string) { text += data; },
		getText: () => text,
		setText(value: string) { text = value; },
	};
	const foreign: EditorFactory = () => base;
	session.ctx.ui.setEditorComponent(foreign);
	await emit("resources_discover", { reason: "startup" }, session.ctx);
	const wrapped = session.editor();
	assert.ok(wrapped);
	assert.notEqual(wrapped, foreign, "wrap the later extension after all session_start handlers");
	const editor = wrapped({} as never, {} as never, {} as never);
	const lines = editor.render(60).map(stripVTControlCharacters);
	assert.ok(lines.some((line) => line.includes("│") && line.includes("foreign editor body")));
	assert.equal(lines.filter((line) => /gpt-5\s+OpenAI/.test(line)).length, 1, "model line restored once");
	assert.equal(lines.at(-1), "@README completion", "autocomplete stays below the frame");
	editor.handleInput?.("!");
	assert.equal(editor.getText(), "foreign editor body!", "input still reaches the foreign editor");
	await emit("model_select", {}, session.ctx);
	assert.equal(session.editor(), wrapped, "no wrapper nesting on repeated checks");

	session.ctx.ui.setEditorComponent(foreign);
	await emit("thinking_level_select", {}, session.ctx);
	assert.notEqual(session.editor(), foreign, "mid-session overrides heal on surface events");
	session.ctx.ui.setEditorComponent(undefined);
	await emit("model_select", {}, session.ctx);
	assert.ok(session.editor(), "a reset to the stock editor heals too");

	// Session replacement cancels old deferred checks and wraps the new base.
	await emit("session_shutdown", {}, session.ctx);
	session.ctx.ui.setEditorComponent(foreign);
	await emit("model_select", {}, session.ctx);
	await emit("resources_discover", {}, session.ctx);
	t.mock.timers.tick(2000);
	assert.equal(session.editor(), foreign, "shutdown cannot reclaim the editor");
	await emit("session_start", {}, session.ctx);
	await emit("resources_discover", { reason: "reload" }, session.ctx);
	assert.notEqual(session.editor(), foreign);
	await emit("session_shutdown", {}, session.ctx);
	assert.equal(session.editor(), foreign, "shutdown restores the foreign factory");
});

test("editor reconciliation respects the disabled feature", async (t) => {
	writeFileSync(configFile, JSON.stringify({ features: { editor: false } }));
	const { emit } = await setup();
	const session = makeCtx();
	t.after(() => {
		writeFileSync(configFile, "{}");
		return emit("session_shutdown", {}, session.ctx);
	});
	await emit("session_start", {}, session.ctx);
	const foreign: EditorFactory = () => ({}) as never;
	session.ctx.ui.setEditorComponent(foreign);
	await emit("resources_discover", {}, session.ctx);
	await emit("model_select", {}, session.ctx);
	assert.equal(session.editor(), foreign);
});

test("legacy editor notice recognizes Pi's omitted fullscreen default", async () => {
	writeFileSync(configFile, JSON.stringify({ fixedEditor: { enabled: true } }));
	const { emit } = await setup(() => ({}));
	const session = makeCtx();
	try {
		await emit("session_start", {}, session.ctx);
		assert.equal(session.notices.length, 1);
		assert.match(session.notices[0]!, /already|already using|now controls/i);
		assert.doesNotMatch(session.notices[0]!, /set .*tuiMode|enable .*fullscreen/i);
	} finally {
		await emit("session_shutdown", {}, session.ctx);
		writeFileSync(configFile, "{}");
	}
});

test("non-TUI modes install nothing", async () => {
	const { emit } = await setup();
	const rpc = makeCtx();
	(rpc.ctx as { mode: string }).mode = "rpc";
	await emit("session_start", {}, rpc.ctx);
	assert.equal(rpc.footerFactory(), undefined);
	assert.equal(rpc.editor(), undefined);
	await emit("session_shutdown", {}, rpc.ctx);
});
