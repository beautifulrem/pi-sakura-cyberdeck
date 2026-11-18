import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { readGitStatus } from "../extensions/zentui/git";

function realGit(): string | undefined {
	if (process.platform === "win32") return undefined;
	try {
		return execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim() || undefined;
	} catch {
		return undefined;
	}
}

const ALL_PROBES = { readStatus: true, readState: true, readExactTag: true, readMetrics: true };

/** Put a logging `git` shim first on PATH; returns the git subcommands spawned since the last call. */
function shimGit(t: { after: (fn: () => void) => void }, git: string): () => string[] {
	const root = mkdtempSync(join(tmpdir(), "zentui-gitshim-"));
	const bin = join(root, "bin");
	const log = join(root, "calls");
	mkdirSync(bin);
	writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$*" >> "${log}"\nexec "${git}" "$@"\n`);
	chmodSync(join(bin, "git"), 0o755);
	const originalPath = process.env.PATH;
	process.env.PATH = `${bin}${delimiter}${originalPath ?? ""}`;
	t.after(() => {
		process.env.PATH = originalPath;
	});
	let seen = 0;
	return () => {
		const lines = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
		const fresh = lines.slice(seen);
		seen = lines.length;
		// `git --version` (show-stash support) is memoised per process: not a per-refresh cost.
		return fresh
			.map((line) => line.replace(/^-c core\.fsmonitor=false /, ""))
			.filter((line) => line !== "--version");
	};
}

const git = realGit();

test(
	"outside a repository a refresh spawns only the rev-parse check",
	{ skip: git ? false : "needs git and a POSIX shell" },
	async (t) => {
		const spawned = shimGit(t, git ?? "git");
		const dir = mkdtempSync(join(tmpdir(), "zentui-norepo-"));
		assert.deepEqual(await readGitStatus(dir, ALL_PROBES), { kind: "not_a_repo" });
		assert.deepEqual(spawned(), ["rev-parse --git-dir"]);
	},
);

test(
	"inside a repository every requested probe still runs",
	{ skip: git ? false : "needs git and a POSIX shell" },
	async (t) => {
		const spawned = shimGit(t, git ?? "git");
		const dir = mkdtempSync(join(tmpdir(), "zentui-repo-"));
		const run = (...args: string[]) =>
			execFileSync(git ?? "git", ["-c", "user.name=t", "-c", "user.email=t@e", ...args], {
				cwd: dir,
			});
		run("init", "-q", "-b", "main");
		writeFileSync(join(dir, "a.txt"), "one\n");
		run("add", "a.txt");
		run("commit", "-q", "-m", "init");
		run("tag", "v1.0.0");
		writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
		writeFileSync(join(dir, "new.txt"), "x");
		mkdirSync(join(dir, "sub"));
		spawned();

		// From a subdirectory too: the repo is found by walking up.
		const result = await readGitStatus(join(dir, "sub"), ALL_PROBES);
		assert.equal(result.kind, "ok");
		if (result.kind !== "ok") return;
		assert.equal(result.status.branch, "main");
		assert.equal(result.status.modified, 1);
		assert.equal(result.status.untracked, 1);
		assert.equal(result.status.commit?.tag, "v1.0.0");
		assert.deepEqual(result.status.metrics, { added: 1, deleted: 0 });
		assert.equal(result.status.gitStateLabel, undefined);
		const calls = spawned().map((line) => line.split(" ")[0]);
		for (const sub of ["rev-parse", "status", "describe", "diff"]) assert.ok(calls.includes(sub), sub);
	},
);
