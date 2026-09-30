import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitNumstat, parseGitStatusPorcelain } from "../extensions/zentui/git";
import { applyProjectRefreshToState } from "../extensions/zentui/project-state";
import { createInitialState } from "../extensions/zentui/state";
import { emptyGitStatus } from "../extensions/zentui/git";

const PORCELAIN_V2 = [
	"# branch.oid 1234567890abcdef1234567890abcdef12345678",
	"# branch.head feature/x",
	"# branch.upstream origin/feature/x",
	"# branch.ab +2 -1",
	"# stash 3",
	"1 .M N... 100644 100644 100644 aaa bbb src/a.ts",
	"1 M. N... 100644 100644 100644 aaa bbb src/b.ts",
	"1 D. N... 100644 000000 000000 aaa bbb src/c.ts",
	"1 .T N... 100644 100644 120000 aaa bbb link",
	"2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts",
	"u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
	"? untracked.txt",
	"? other.txt",
	"",
].join("\n");

test("porcelain v2 parser reads branch, ahead/behind, stash header and counts", () => {
	const status = parseGitStatusPorcelain(PORCELAIN_V2);
	assert.equal(status.branch, "feature/x");
	assert.equal(status.ahead, 2);
	assert.equal(status.behind, 1);
	assert.equal(status.stashed, 3);
	assert.equal(status.modified, 1);
	assert.equal(status.staged, 1);
	assert.equal(status.deleted, 1);
	assert.equal(status.typechanged, 1);
	assert.equal(status.renamed, 1);
	assert.equal(status.conflicted, 1);
	assert.equal(status.untracked, 2);
	assert.deepEqual(status.commit, {
		oid: "1234567890abcdef1234567890abcdef12345678",
		detached: false,
		tag: null,
	});
});

test("porcelain parser: detached head, initial commit, stash fallback for old git", () => {
	const detached = parseGitStatusPorcelain("# branch.oid abc123\n# branch.head (detached)\n", 2);
	assert.equal(detached.branch, undefined);
	assert.equal(detached.commit?.detached, true);
	assert.equal(detached.stashed, 2);
	const initial = parseGitStatusPorcelain("# branch.oid (initial)\n# branch.head main\n");
	assert.equal(initial.commit?.oid, null);
	assert.equal(initial.stashed, 0);
	assert.deepEqual(parseGitNumstat("3\t1\ta.ts\n-\t-\tbin.png\nbad\n10\t0\tb.ts\n"), {
		added: 13,
		deleted: 1,
	});
});

test("git errors mark status unavailable instead of freezing stale counts", () => {
	const state = createInitialState(emptyGitStatus());
	applyProjectRefreshToState(state, {
		cwd: "/p",
		previousCwd: undefined,
		git: { kind: "ok", status: parseGitStatusPorcelain(PORCELAIN_V2) },
	});
	assert.equal(state.modified, 1);
	assert.equal(state.gitUnavailable, false);
	applyProjectRefreshToState(state, { cwd: "/p", previousCwd: "/p", git: { kind: "error" } });
	assert.equal(state.gitUnavailable, true);
	assert.equal(state.modified, 0);
	assert.equal(state.branch, "feature/x");
});

test("repository-controlled branch/tag/version strings are sanitized on ingest", () => {
	const state = createInitialState(emptyGitStatus());
	const status = parseGitStatusPorcelain("# branch.oid abc\n# branch.head main\x1b]0;x\x07\n");
	status.commit = { oid: "abc\x1b[2J", detached: false, tag: "v1\x07" };
	applyProjectRefreshToState(state, {
		cwd: "/p",
		previousCwd: undefined,
		git: { kind: "ok", status },
		runtime: { kind: "ok", runtime: { name: "nodejs", symbol: "n", style: "", version: "v1\x1b[31m" } },
	});
	assert.equal(state.branch, "main");
	assert.equal(state.commit?.oid, null);
	assert.equal(state.commit?.tag, "v1");
	assert.equal(state.runtime?.version, "v1");
});

test("readGitStatus runs against a real repository when git is available", async (t) => {
	const { execFileSync } = await import("node:child_process");
	try {
		execFileSync("git", ["--version"]);
	} catch {
		t.skip("git not installed");
		return;
	}
	const { readGitStatus } = await import("../extensions/zentui/git");
	const dir = mkdtempSync(join(tmpdir(), "zentui-git-"));
	assert.deepEqual(await readGitStatus(dir, { readState: true }), { kind: "not_a_repo" });
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
	writeFileSync(join(dir, "a.txt"), "a");
	mkdirSync(join(dir, ".git", "rebase-merge"));
	writeFileSync(join(dir, ".git", "rebase-merge", "msgnum"), "2\n");
	writeFileSync(join(dir, ".git", "rebase-merge", "end"), "5\n");
	const result = await readGitStatus(dir, { readStatus: true, readState: true });
	assert.equal(result.kind, "ok");
	if (result.kind === "ok") {
		assert.equal(result.status.untracked, 1);
		assert.equal(result.status.branch, "main");
		assert.equal(result.status.gitStateLabel, "REBASING 2/5");
	}
});
