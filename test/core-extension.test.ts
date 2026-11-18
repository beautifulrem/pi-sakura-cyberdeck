import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// config.ts resolves its path at import time: point it at a scratch agent dir first.
const agentDir = mkdtempSync(join(tmpdir(), "zentui-core-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const configFile = join(agentDir, "sakura-cyberdeck-zentui.json");

type Handler = (event: unknown, ctx: unknown) => unknown;
type CommandHandler = (args: string, ctx: unknown) => Promise<void>;
type FooterComponent = { render(width: number): string[]; dispose?(): void };
type FooterFactory = (...args: unknown[]) => FooterComponent;
type Transformer = (markdown: string, context: unknown) => string;

async function setup() {
	const { default: zentui } = await import("../extensions/zentui/index");
	const handlers = new Map<string, Handler[]>();
	const transformers: Transformer[] = [];
	let command: CommandHandler | undefined;
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand(_name: string, options: { handler: CommandHandler }) {
			command = options.handler;
		},
		registerMarkdownTransformer(transformer: Transformer) {
			transformers.push(transformer);
		},
		getThinkingLevel: () => "off",
	};
	zentui(pi as never);
	const emit = async (event: string, payload: unknown, ctx: unknown) => {
		for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
	};
	const run = (args: string, ctx: unknown) => {
		assert.ok(command, "/zentui registered");
		return command(args, ctx);
	};
	return { emit, run, transformers };
}

/** A Pi-like UI: setFooter disposes the previous footer before mounting the next (interactive-mode.js). */
function makeCtx(mode = "tui") {
	const notices: string[] = [];
	const tui = { renders: 0, invalidations: 0, onInvalidate: () => {} };
	const tuiHandle = {
		requestRender: () => {
			tui.renders += 1;
		},
		invalidate: () => {
			tui.invalidations += 1;
			tui.onInvalidate();
		},
	};
	let footerFactory: FooterFactory | undefined;
	let footer: FooterComponent | undefined;
	let editorFactory: unknown;
	let trustChecks = 0;
	const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t, getColorMode: () => "256color" };
	const ctx = {
		mode,
		hasUI: mode !== "print",
		cwd: mkdtempSync(join(tmpdir(), "zentui-core-cwd-")),
		model: { provider: "openai", id: "gpt-5", contextWindow: 1000 },
		// Untrusted: probes never spawn, but every scheduled refresh still asks.
		isProjectTrusted: () => {
			trustChecks += 1;
			return false;
		},
		getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
		sessionManager: { getEntries: () => [], getLeafId: () => "leaf", getSessionId: () => "s" },
		ui: {
			theme,
			notify: (message: string) => notices.push(message),
			setFooter(factory: FooterFactory | undefined) {
				footer?.dispose?.();
				footerFactory = factory;
				footer = factory?.(tuiHandle, theme, {
					getGitBranch: () => "main",
					getExtensionStatuses: () => new Map(),
					onBranchChange: () => () => {},
				});
			},
			setEditorComponent(factory: unknown) {
				editorFactory = factory;
			},
			getEditorComponent: () => editorFactory,
		},
	};
	return {
		ctx,
		tui,
		notices,
		trustChecks: () => trustChecks,
		footerFactory: () => footerFactory,
		footer: () => footer,
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("settings that cannot change probes do not force a project rescan", async (t) => {
	writeFileSync(configFile, "{}");
	const { emit, run } = await setup();
	const session = makeCtx();
	t.after(() => emit("session_shutdown", {}, session.ctx));
	await emit("session_start", {}, session.ctx);
	await settle();
	const before = session.trustChecks();
	for (let i = 0; i < 3; i++) await run("copy-friendly toggle", session.ctx);
	await run("pulse toggle", session.ctx);
	assert.equal(session.trustChecks(), before, "no probe per key press");

	// A setting that changes what is probed still refreshes immediately.
	await run('format "$cwd $git_branch $package"', session.ctx);
	assert.equal(session.trustChecks(), before + 1);
});

test("/zentui toggles outside the TUI start from the saved config", async () => {
	for (const mode of ["rpc", "print"]) {
		writeFileSync(configFile, JSON.stringify({ features: { thinkingTrail: false } }));
		const { emit, run, transformers } = await setup();
		const session = makeCtx(mode);
		try {
			await emit("session_start", {}, session.ctx);
			assert.equal(session.footerFactory(), undefined, `${mode}: no UI is installed`);
			const thinking = { messageType: "assistant-thinking", availableWidth: 80 };
			assert.equal(transformers[0]?.("Step one.\n\nStep two.", thinking), "Step one.\n\nStep two.", `${mode}: saved trail-off is honoured`);
			await run("thinking toggle", session.ctx);
			const saved = JSON.parse(readFileSync(configFile, "utf8"));
			assert.equal(saved.features.thinkingTrail, true, `${mode}: toggled from the saved value`);
			assert.deepEqual(session.notices.filter((n) => /invalid|fixed-editor/i.test(n)), []);
		} finally {
			await emit("session_shutdown", {}, session.ctx);
		}
	}
	writeFileSync(configFile, "{}");
});

test("a footer replaced by another extension is released, not deleted", async () => {
	writeFileSync(configFile, "{}");
	const { emit, run } = await setup();
	const session = makeCtx();
	const other: FooterFactory = () => ({ render: () => ["other footer"] });
	try {
		await emit("session_start", {}, session.ctx);
		await settle();
		const zentuiFooter = session.footerFactory();
		assert.ok(zentuiFooter);

		// Another extension takes the footer; Pi disposes Zentui's.
		session.ctx.ui.setFooter(other);
		const checks = session.trustChecks();
		await emit("agent_end", {}, session.ctx);
		await emit("tool_execution_end", {}, session.ctx);
		assert.equal(session.trustChecks(), checks, "no project probes for an invisible footer");

		await run("statusline disable", session.ctx);
		assert.equal(session.footerFactory(), other, "disabling Zentui's status line keeps theirs");

		await run("statusline enable", session.ctx);
		assert.notEqual(session.footerFactory(), other, "an explicit enable reinstalls Zentui's footer");
		assert.match(session.footer()?.render(120)[0] ?? "", /main/);

		// Enabling while the config already says enabled also reclaims it.
		session.ctx.ui.setFooter(other);
		await run("statusline enable", session.ctx);
		assert.notEqual(session.footerFactory(), other);

		session.ctx.ui.setFooter(other);
		await emit("session_shutdown", {}, session.ctx);
		assert.equal(session.footerFactory(), other, "shutdown leaves the other extension's footer");
	} finally {
		await emit("session_shutdown", {}, session.ctx);
		writeFileSync(configFile, "{}");
	}
});

test("a session restart keeps the new footer live after disposing the old one", async () => {
	writeFileSync(configFile, "{}");
	const { emit } = await setup();
	const session = makeCtx();
	try {
		await emit("session_start", {}, session.ctx);
		// A second start without shutdown: mounting the new footer disposes the old instance.
		await emit("session_start", {}, session.ctx);
		await settle();
		const checks = session.trustChecks();
		await emit("agent_end", {}, session.ctx);
		assert.equal(session.trustChecks(), checks + 1, "the new footer still drives project refreshes");
	} finally {
		await emit("session_shutdown", {}, session.ctx);
	}
});
