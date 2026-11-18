import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { mergeConfig, type PolishedTuiConfig } from "../extensions/zentui/config";
import { footerWantsPulse, installFooter } from "../extensions/zentui/footer";
import { invalidateSessionCaches } from "../extensions/zentui/format";
import { emptyGitStatus } from "../extensions/zentui/git";
import type { LiveContextOverride } from "../extensions/zentui/live-context";
import { createInitialState } from "../extensions/zentui/state";

const cwd = mkdtempSync(join(tmpdir(), "zentui-core-footer-"));

/** Only the context segment, as plain text. */
const contextOnly: PolishedTuiConfig = mergeConfig({
	contextStyle: "text",
	footerFormat: "$context",
});

function renderContext(options: {
	model: { provider: string; id: string; contextWindow: number } | undefined;
	usage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
	live?: LiveContextOverride;
}): string {
	invalidateSessionCaches();
	let footer: { render(width: number): string[]; dispose?(): void } | undefined;
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
	const ctx = {
		cwd,
		model: options.model,
		getContextUsage: () => options.usage,
		sessionManager: { getEntries: () => [], getLeafId: () => "leaf", getSessionId: () => "s" },
		ui: {
			setFooter(factory: (...args: unknown[]) => typeof footer) {
				footer = factory(
					{ requestRender() {} },
					theme,
					{
						getGitBranch: () => undefined,
						getExtensionStatuses: () => new Map(),
						onBranchChange: () => () => {},
					},
				);
			},
		},
	};
	installFooter(ctx as never, createInitialState(emptyGitStatus()), () => contextOnly, {
		setRequestRender() {},
		scheduleProjectRefresh() {},
		getLiveContext: () => options.live,
		isAgentWorking: () => false,
		setAnimationSync() {},
	});
	const line = stripVTControlCharacters(footer?.render(80)[0] ?? "").trim();
	footer?.dispose?.();
	return line;
}

test("routed virtual models use the context window Pi reports", () => {
	// Pi's virtual models carry contextWindow 0; getContextUsage() answers for the routed model.
	const virtualModel = { provider: "router", id: "auto", contextWindow: 0 };
	const usage = { tokens: 50_000, contextWindow: 200_000, percent: 25 };
	assert.equal(renderContext({ model: virtualModel, usage }), "25%/200k");
	assert.equal(
		renderContext({ model: virtualModel, usage, live: { tokens: 100_000 } }),
		"50%/200k",
		"live streaming usage divides by the routed window too",
	);
	// No usage and no positive model window: still unknown.
	assert.equal(renderContext({ model: virtualModel, usage: undefined }), "--");
	// Ordinary models are unchanged, including the model-only fallback.
	const model = { provider: "openai", id: "gpt-5", contextWindow: 1000 };
	assert.equal(renderContext({ model, usage: { tokens: 100, contextWindow: 1000, percent: 10 } }), "10%/1.0k");
	assert.equal(renderContext({ model, usage: undefined, live: { tokens: 300 } }), "30%/1.0k");
});

test("footer pulse recognises format aliases of gradient variables", () => {
	const pulse = (footerFormat: string) =>
		footerWantsPulse(mergeConfig({ animations: { footerPulse: true }, footerFormat }));
	assert.equal(pulse("$cwd $tokens"), true);
	assert.equal(pulse("$directory $tokens"), true, "$directory is an alias of $cwd");
	assert.equal(pulse("${directory} $tokens"), true);
	assert.equal(pulse("$context"), true);
	assert.equal(pulse("$os"), true);
	assert.equal(pulse("$tokens $cost $directoryx"), false);
	assert.equal(pulse("$branch $status"), false);
});
