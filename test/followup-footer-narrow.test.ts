import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { getColorMode, setColorMode } from "../extensions/shared/color";
import { defaultConfig, mergeConfig, type PolishedTuiConfig } from "../extensions/zentui/config";
import { installFooter } from "../extensions/zentui/footer";
import { invalidateSessionCaches } from "../extensions/zentui/format";
import { emptyGitStatus } from "../extensions/zentui/git";
import { createInitialState } from "../extensions/zentui/state";

function makeFooter(config: PolishedTuiConfig, options: { cwdName?: string; branch?: string } = {}) {
	invalidateSessionCaches();
	const cwd = join(mkdtempSync(join(tmpdir(), "zentui-followup-footer-")), options.cwdName ?? "pi-sakura-cyberdeck");
	mkdirSync(cwd, { recursive: true });
	let footer: { render(width: number): string[]; dispose?(): void } | undefined;
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
	const ctx = {
		cwd,
		model: { provider: "openai", id: "gpt-5", contextWindow: 200_000 },
		getContextUsage: () => ({ tokens: 50_000, contextWindow: 200_000, percent: 25 }),
		sessionManager: { getEntries: () => [], getLeafId: () => "leaf", getSessionId: () => "s" },
		ui: {
			setFooter(factory: (...args: unknown[]) => typeof footer) {
				footer = factory({ requestRender() {} }, theme, {
					getGitBranch: () => options.branch,
					getExtensionStatuses: () => new Map(),
					onBranchChange: () => () => {},
				});
			},
		},
	};
	installFooter(ctx as never, createInitialState(emptyGitStatus()), () => config, {
		setRequestRender() {},
		scheduleProjectRefresh() {},
		isAgentWorking: () => false,
		setAnimationSync() {},
	});
	return footer!;
}

/** Split a very wide render (padding, left, big gap, right, padding) into its parts. */
function wideParts(raw: string) {
	const content = stripVTControlCharacters(raw).slice(1, -1);
	const match = /^(.*?) {3,}(\S.*)$/.exec(content);
	assert.ok(match, content);
	const gap = raw.search(/ {3,}/);
	return { left: match[1]!.trimStart() === "" ? "" : match[1]!, right: match[2]!, rawRight: raw.slice(gap).replace(/^ +/, "").slice(0, -1) };
}

const CASES: [string, PolishedTuiConfig, { cwdName?: string; branch?: string }][] = [
	["default", defaultConfig, { branch: "main" }],
	["right-only format", mergeConfig({ footerFormat: "$fill$context $tokens $cost" }), {}],
	["right-only text context", mergeConfig({ contextStyle: "text", footerFormat: "$fill$context $tokens $cost" }), {}],
	["CJK default", defaultConfig, { cwdName: "樱花赛博甲板项目目录", branch: "功能分支名称" }],
	["CJK on both sides", mergeConfig({ footerFormat: "$branch$fill$cwd $tokens" }), { cwdName: "樱花赛博甲板项目目录", branch: "功能分支名称" }],
];

test("narrow footers keep the right side whole and truncate the left into the rest", () => {
	const previous = getColorMode();
	setColorMode("truecolor");
	try {
		for (const [name, config, options] of CASES) {
			const footer = makeFooter(config, options);
			const { left, right, rawRight } = wideParts(footer.render(300)[0]!);
			const rightWidth = visibleWidth(right);
			for (const width of [25, 40, 60, 120]) {
				const label = `${name} @${width}`;
				const raw = footer.render(width)[0]!;
				const plain = stripVTControlCharacters(raw);
				assert.ok(visibleWidth(raw) <= width, `${label}: ${visibleWidth(raw)} > ${width}`);
				assert.ok(plain.trim(), `${label}: never blank`);
				const inner = width - 2;
				const content = plain.slice(1).trimEnd();
				if (rightWidth > inner) {
					// Right side alone does not fit: show as much of it as fits.
					assert.ok(right.startsWith(content.trimStart()), `${label}: ${JSON.stringify(content)}`);
					continue;
				}
				assert.ok(raw.endsWith(`${rawRight} `), `${label}: right side whole, colours intact: ${JSON.stringify(plain)}`);
				const leftPart = content.slice(0, content.length - right.length).trimEnd();
				assert.ok(left.startsWith(leftPart), `${label}: left is a prefix: ${JSON.stringify(leftPart)}`);
				if (leftPart) {
					assert.ok(visibleWidth(leftPart) + 1 + rightWidth <= inner, `${label}: at least one space gap`);
				}
				if (visibleWidth(left) + 1 + rightWidth <= inner) assert.equal(leftPart, left, `${label}: unchanged when it fits`);
			}
			footer.dispose?.();
		}
	} finally {
		setColorMode(previous);
	}
});

test("right-only footer formats are not blank at 25 columns", () => {
	const footer = makeFooter(mergeConfig({ contextStyle: "text", footerFormat: "$fill$context $tokens $cost" }));
	const line = stripVTControlCharacters(footer.render(25)[0]!);
	assert.equal(line, "   25%/200k ↑0 ↓0 $0.000 ");
	assert.equal(visibleWidth(line), 25);
	const gauge = stripVTControlCharacters(makeFooter(mergeConfig({ footerFormat: "$fill$context $tokens $cost" })).render(25)[0]!);
	assert.ok(gauge.startsWith(" [███░░░░░░░] 25%/200k"), gauge);
	assert.ok(visibleWidth(gauge) <= 25);
});
