import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeDisplayText } from "../extensions/zentui/extension-status";
import {
	computeUsageTotals,
	formatCount,
	formatCwdLabel,
	getCachedContextUsage,
	getUsageTotals,
	invalidateSessionCaches,
	type UsageSessionEntry,
} from "../extensions/zentui/format";
import { cleanVersion, readPackageVersion } from "../extensions/zentui/package-version";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("formatCount rolls over cleanly at unit boundaries", () => {
	const cases: [number, string][] = [
		[0, "0"],
		[999, "999"],
		[1000, "1.0k"],
		[9_949, "9.9k"],
		[9_950, "10k"],
		[999_499, "999k"],
		[999_500, "1.0M"],
		[999_999, "1.0M"],
		[1_000_000, "1.0M"],
		[9_949_999, "9.9M"],
		[9_950_000, "10M"],
		[12_345_678, "12M"],
	];
	for (const [value, expected] of cases) assert.equal(formatCount(value), expected, String(value));
});

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0, cost = 0) => ({
	input,
	output,
	cacheRead,
	cacheWrite,
	cost: { total: cost },
});

const fixtureEntries: UsageSessionEntry[] = [
	{ type: "message", message: { role: "user" } },
	{ type: "message", message: { role: "assistant", usage: usage(100, 10, 0, 50, 0.01) } },
	{ type: "message", message: { role: "toolResult", usage: usage(5, 1, 0, 0, 0.001) } },
	{ type: "message", message: { role: "toolResult" } },
	{ type: "usage", usage: usage(20, 2, 0, 0, 0.002) },
	{ type: "compaction", usage: usage(300, 30, 0, 0, 0.03) },
	{ type: "compaction" },
	{ type: "branch_summary", usage: usage(40, 4, 0, 0, 0.004) },
	{ type: "custom", usage: usage(9999, 9999) },
	{ type: "message", message: { role: "assistant", usage: usage(10, 5, 30, 0, 0.02) } },
];

test("usage totals mirror Pi's footer accumulation across entry types", () => {
	const totals = computeUsageTotals(fixtureEntries);
	assert.equal(totals.input, 100 + 5 + 20 + 300 + 40 + 10);
	assert.equal(totals.output, 10 + 1 + 2 + 30 + 4 + 5);
	assert.equal(totals.cacheRead, 30);
	assert.equal(totals.cacheWrite, 50);
	assert.ok(Math.abs(totals.cost - 0.067) < 1e-9);
	assert.equal(totals.latestCacheHitRate, 75);
	// 0.87-era entries without usage fields must not throw or produce NaN.
	const sparse = computeUsageTotals([
		{ type: "message", message: { role: "assistant", usage: {} } },
		{ type: "usage" },
	]);
	assert.deepEqual({ ...sparse, latestCacheHitRate: undefined }, {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		latestCacheHitRate: undefined,
	});
});

function fakeSession(entries: UsageSessionEntry[], withCount = true) {
	let leaf = "leaf-1";
	let getEntriesCalls = 0;
	let contextCalls = 0;
	const sessionManager: Record<string, unknown> = {
		getEntries: () => {
			getEntriesCalls += 1;
			return entries;
		},
		getLeafId: () => leaf,
		getSessionId: () => "session",
	};
	if (withCount) sessionManager.getEntryCount = () => entries.length;
	const ctx = {
		sessionManager,
		model: { provider: "p", id: "m", contextWindow: 1000 },
		getContextUsage: () => {
			contextCalls += 1;
			return { tokens: 100, contextWindow: 1000, percent: 10 };
		},
	};
	return {
		ctx: ctx as never,
		moveLeaf: (id: string) => {
			leaf = id;
		},
		counts: () => ({ getEntriesCalls, contextCalls }),
	};
}

test("usage totals and context usage are cached per session state", () => {
	invalidateSessionCaches();
	const entries = [...fixtureEntries];
	const session = fakeSession(entries);
	for (let i = 0; i < 5; i++) {
		getUsageTotals(session.ctx);
		getCachedContextUsage(session.ctx);
	}
	assert.deepEqual(session.counts(), { getEntriesCalls: 1, contextCalls: 1 });

	entries.push({ type: "usage", usage: usage(1, 1) });
	session.moveLeaf("leaf-2");
	assert.equal(getUsageTotals(session.ctx).input, 476);
	getCachedContextUsage(session.ctx);
	assert.deepEqual(session.counts(), { getEntriesCalls: 2, contextCalls: 2 });

	// Model change invalidates context usage only.
	(session.ctx as { model: { id: string } }).model.id = "other";
	getCachedContextUsage(session.ctx);
	getUsageTotals(session.ctx);
	assert.deepEqual(session.counts(), { getEntriesCalls: 2, contextCalls: 3 });

	invalidateSessionCaches();
	getUsageTotals(session.ctx);
	assert.equal(session.counts().getEntriesCalls, 3);
});

test("Pi 0.87 session managers without getEntryCount still cache by leaf", () => {
	invalidateSessionCaches();
	const session = fakeSession([...fixtureEntries], false);
	getUsageTotals(session.ctx);
	getUsageTotals(session.ctx);
	assert.equal(session.counts().getEntriesCalls, 1);
	session.moveLeaf("next");
	getUsageTotals(session.ctx);
	assert.equal(session.counts().getEntriesCalls, 2);
});

test("cleanVersion rejects control characters and junk", () => {
	assert.equal(cleanVersion("1.2.3"), "1.2.3");
	assert.equal(cleanVersion(' "v2.0.0-beta.1" '), "2.0.0-beta.1");
	assert.equal(cleanVersion("via"), "via");
	for (const bad of [
		"1.0\x1b]0;pwned\x07",
		"\x1b[31m1.0",
		"1.0\u009b",
		"1.0\u202e",
		"1.0 beta",
		"{1.0}",
		"",
		"   ",
		"x".repeat(65),
	]) {
		assert.equal(cleanVersion(bad), undefined, JSON.stringify(bad));
	}
});

test("package version supports package.json, Cargo.toml, pyproject.toml, composer.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "zentui-pkg-"));
	assert.equal(readPackageVersion(dir), null);
	writeFileSync(
		join(dir, "Cargo.toml"),
		'[package]\nname = "x"\nversion.workspace = true\n\n[workspace.package]\nversion = "0.4.2" # c\n',
	);
	assert.deepEqual(readPackageVersion(dir), { ecosystem: "rust", version: "0.4.2" });
	writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.0.0\u001b]8;;x\u0007" }));
	// Malicious package.json is ignored; the next manifest wins.
	assert.deepEqual(readPackageVersion(dir), { ecosystem: "rust", version: "0.4.2" });
	writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "3.1.4" }));
	assert.deepEqual(readPackageVersion(dir), { ecosystem: "nodejs", version: "3.1.4" });

	const py = mkdtempSync(join(tmpdir(), "zentui-py-"));
	writeFileSync(join(py, "pyproject.toml"), '[tool.poetry]\nversion = "2.0"\n[project]\nname = "x"\n');
	assert.deepEqual(readPackageVersion(py), { ecosystem: "python", version: "2.0" });
	const php = mkdtempSync(join(tmpdir(), "zentui-php-"));
	writeFileSync(join(php, "composer.json"), '{"version": "5.0.1"}');
	assert.deepEqual(readPackageVersion(php), { ecosystem: "php", version: "5.0.1" });
});

test("externally sourced footer text is sanitized", () => {
	assert.equal(sanitizeDisplayText("main\x1b]0;evil\x07\x1b[2J\u202e"), "main");
	assert.equal(sanitizeDisplayText("feat/\u0007bell"), "feat/bell");
	assert.equal(formatCwdLabel("/tmp/evil\x1b[31mdir", ""), "evildir");
	assert.equal(formatCwdLabel("/home/u/proj", "", { mode: "full", home: "/home/u" }), "~/proj");
});
