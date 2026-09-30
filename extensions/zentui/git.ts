import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const GIT_COMMAND_TIMEOUT_MS = 3_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
/** Never let the footer take git's index lock or run a repo-configured fsmonitor hook. */
const GIT_BASE_ARGS = ["-c", "core.fsmonitor=false"] as const;

/**
 * Starship `git_commit`-style info derived from the porcelain probe.
 *
 * `oid` is the full `branch.oid` from `git status --porcelain=2 --branch`.
 * `detached` mirrors `branch.head === "(detached)"`. `tag` is populated only
 * when the caller opts into the exact-tag probe; `null` means no exact-match
 * tag or the probe was skipped.
 */
export type GitCommitInfo = {
	oid: string | null;
	detached: boolean;
	tag: string | null;
};

/**
 * Starship `git_metrics`-style aggregate line-change counts.
 * See https://starship.rs/config/#git-metrics
 */
export type GitMetricsInfo = {
	added: number;
	deleted: number;
};

export type GitStatusSummary = {
	branch?: string;
	ahead: number;
	behind: number;
	conflicted: number;
	untracked: number;
	stashed: number;
	modified: number;
	staged: number;
	renamed: number;
	deleted: number;
	typechanged: number;
	gitStateLabel?: string;
	commit?: GitCommitInfo;
	metrics?: GitMetricsInfo | null;
	/** The last status probe failed (timeout, lock, crash): counts are unknown, not zero. */
	gitUnavailable?: boolean;
};

export type GitReadResult =
	| { kind: "ok"; status: GitStatusSummary }
	| { kind: "not_a_repo" }
	| { kind: "error" };

export type GitStatePaths = {
	rebaseMerge?: boolean;
	rebaseApply?: boolean;
	mergeHead?: boolean;
	cherryPickHead?: boolean;
	revertHead?: boolean;
	bisectLog?: boolean;
	rebaseMsgnum?: string;
	rebaseEnd?: string;
};

export function emptyGitStatus(): GitStatusSummary {
	return {
		branch: undefined,
		ahead: 0,
		behind: 0,
		conflicted: 0,
		untracked: 0,
		stashed: 0,
		modified: 0,
		staged: 0,
		renamed: 0,
		deleted: 0,
		typechanged: 0,
		gitStateLabel: undefined,
		commit: undefined,
		metrics: undefined,
		gitUnavailable: undefined,
	};
}

/**
 * Parse `git status --porcelain=2 --branch [--show-stash]` output. The
 * `# stash <n>` header (git ≥ 2.35) sets `stashed`; `stashCount` is used when
 * the header is absent (older git, counted separately).
 */
export function parseGitStatusPorcelain(stdoutText: string, stashCount = 0): GitStatusSummary {
	const status = emptyGitStatus();
	status.stashed = stashCount;

	let oid: string | null = null;
	let sawBranchHead = false;
	let detached = false;

	for (const line of stdoutText.split(/\r?\n/)) {
		if (!line) continue;
		if (line.startsWith("#")) {
			if (line.startsWith("# branch.oid ")) {
				const value = line.slice("# branch.oid ".length).trim();
				if (value && value !== "(initial)") oid = value;
			} else if (line.startsWith("# branch.head ")) {
				sawBranchHead = true;
				const branch = line.slice("# branch.head ".length).trim();
				if (branch === "(detached)") {
					detached = true;
					status.branch = undefined;
				} else if (branch) {
					status.branch = branch;
				}
			} else if (line.startsWith("# branch.ab ")) {
				const match = line.match(/\+(\d+)\s+-(\d+)/);
				if (match) {
					status.ahead = Number(match[1] ?? 0);
					status.behind = Number(match[2] ?? 0);
				}
			} else if (line.startsWith("# stash ")) {
				const count = Number(line.slice("# stash ".length).trim());
				if (Number.isInteger(count) && count >= 0) status.stashed = count;
			}
			continue;
		}

		if (line.startsWith("? ")) {
			status.untracked += 1;
			continue;
		}
		if (line.startsWith("u ")) {
			status.conflicted += 1;
			continue;
		}
		if (!(line.startsWith("1 ") || line.startsWith("2 "))) continue;

		const xy = line.split(" ")[1] ?? "..";
		const x = xy[0] ?? ".";
		const y = xy[1] ?? ".";

		if (x === "R") status.renamed += 1;
		else if (x === "D") status.deleted += 1;
		else if (x === "T") status.typechanged += 1;
		else if (x !== "." && x !== " ") status.staged += 1;

		if (y === "M") status.modified += 1;
		else if (y === "D") status.deleted += 1;
		else if (y === "T") status.typechanged += 1;
	}

	// Only populate commit info when we actually saw branch headers.
	if (sawBranchHead) {
		status.commit = { oid, detached, tag: null };
	}

	return status;
}

/**
 * Parse `git diff --numstat` output into aggregate added/deleted counts.
 * Binary rows (`-`) and malformed lines are skipped.
 */
export function parseGitNumstat(stdoutText: string): GitMetricsInfo {
	let added = 0;
	let deleted = 0;
	for (const line of stdoutText.split(/\r?\n/)) {
		if (!line) continue;
		const parts = line.split("\t");
		if (parts.length < 3) continue;
		const a = parts[0];
		const d = parts[1];
		if (a === "-" || d === "-") continue;
		const na = Number(a);
		const nd = Number(d);
		if (!Number.isFinite(na) || !Number.isFinite(nd) || na < 0 || nd < 0) continue;
		added += na;
		deleted += nd;
	}
	return { added, deleted };
}

function readOptionalText(path: string | undefined): string | undefined {
	if (!path) return undefined;
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return undefined;
	}
}

/** Pure git operation-state detector (Starship order). */
function detectGitState(paths: GitStatePaths): string | undefined {
	if (paths.rebaseMerge || paths.rebaseApply) {
		const msgnum = readOptionalText(paths.rebaseMsgnum);
		const end = readOptionalText(paths.rebaseEnd);
		return /^\d+$/.test(msgnum ?? "") && /^\d+$/.test(end ?? "")
			? `REBASING ${msgnum}/${end}`
			: "REBASING";
	}
	if (paths.mergeHead) return "MERGING";
	if (paths.cherryPickHead) return "CHERRY-PICKING";
	if (paths.revertHead) return "REVERTING";
	if (paths.bisectLog) return "BISECTING";
	return undefined;
}

/** Operation state from the (per-worktree) git dir using plain `existsSync` checks. */
function readGitOperationState(gitDir: string): string | undefined {
	const at = (name: string) => existsSync(join(gitDir, name));
	const rebaseMerge = at("rebase-merge");
	const rebaseApply = !rebaseMerge && at("rebase-apply");
	const rebaseDir = rebaseMerge
		? join(gitDir, "rebase-merge")
		: rebaseApply
			? join(gitDir, "rebase-apply")
			: undefined;
	return detectGitState({
		rebaseMerge,
		rebaseApply,
		mergeHead: at("MERGE_HEAD"),
		cherryPickHead: at("CHERRY_PICK_HEAD"),
		revertHead: at("REVERT_HEAD"),
		bisectLog: at("BISECT_LOG"),
		rebaseMsgnum: rebaseDir ? join(rebaseDir, rebaseMerge ? "msgnum" : "next") : undefined,
		rebaseEnd: rebaseDir ? join(rebaseDir, rebaseMerge ? "end" : "last") : undefined,
	});
}

type GitRunError = Error & { code?: unknown; stderr?: unknown };

function runGit(cwd: string, args: readonly string[]): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(
			"git",
			[...GIT_BASE_ARGS, ...args],
			{
				cwd,
				timeout: GIT_COMMAND_TIMEOUT_MS,
				maxBuffer: GIT_MAX_BUFFER,
				windowsHide: true,
				env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
			},
			(error, stdout, stderr) => {
				if (error) {
					(error as GitRunError).stderr = stderr;
					reject(error);
					return;
				}
				resolvePromise(String(stdout));
			},
		);
	});
}

function isNotARepoError(error: unknown): boolean {
	const err = error as GitRunError | undefined;
	// Missing git binary: nothing to show, same as outside a repository.
	if (err?.code === "ENOENT") return true;
	const message = `${err?.message ?? String(error)}\n${String(err?.stderr ?? "")}`;
	return /not a git repository|outside repository|not a git repo/i.test(message);
}

let showStashSupport: Promise<boolean> | undefined;

/** `--show-stash` emits `# stash N` in porcelain v2 from git 2.35 on. Checked once per process. */
function supportsShowStash(cwd: string): Promise<boolean> {
	showStashSupport ??= runGit(cwd, ["--version"]).then(
		(out) => {
			const match = out.match(/(\d+)\.(\d+)/);
			const major = Number(match?.[1] ?? 0);
			const minor = Number(match?.[2] ?? 0);
			return major > 2 || (major === 2 && minor >= 35);
		},
		() => false,
	);
	return showStashSupport;
}

/**
 * Probes Zentui may run. All default to `false`, so callers spawn only what a
 * visible segment needs.
 */
export type ReadGitStatusOptions = {
	/** `git status --porcelain=2 --branch` (counts, ahead/behind, oid). */
	readStatus?: boolean;
	/** REBASING/MERGING/… label via one `rev-parse --git-dir` + file checks. */
	readState?: boolean;
	/** `git describe --tags --exact-match HEAD` for the git_commit segment. */
	readExactTag?: boolean;
	/** `git diff HEAD --numstat` for the git_metrics segment (staged + unstaged). */
	readMetrics?: boolean;
	/** Add `--ignore-submodules=all` to the metrics diff. */
	ignoreSubmodules?: boolean;
};

export async function readGitStatus(
	cwd: string,
	options: ReadGitStatusOptions = {},
): Promise<GitReadResult> {
	const { readStatus = false, readState = false, readExactTag = false, readMetrics = false } =
		options;
	const numstatArgs = ["diff", "HEAD", "--numstat"];
	if (options.ignoreSubmodules) numstatArgs.push("--ignore-submodules=all");

	// rev-parse doubles as the "is this a repo" check when nothing else runs.
	const gitDirPromise = runGit(cwd, ["rev-parse", "--git-dir"]);
	type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
	// Settle eagerly so a failure that lands while we await rev-parse is never "unhandled".
	const statusPromise: Promise<Settled<GitStatusSummary>> | undefined = readStatus
		? supportsShowStash(cwd).then(async (showStash) => {
				const args = ["status", "--porcelain=2", "--branch"];
				if (showStash) args.push("--show-stash");
				const [statusOut, stashOut] = await Promise.all([
					runGit(cwd, args),
					showStash ? Promise.resolve("") : runGit(cwd, ["stash", "list"]).catch(() => ""),
				]);
				const stashCount = stashOut.split(/\r?\n/).filter((line) => line.trim()).length;
				return parseGitStatusPorcelain(statusOut, stashCount);
			}).then(
				(value): Settled<GitStatusSummary> => ({ ok: true, value }),
				(error: unknown): Settled<GitStatusSummary> => ({ ok: false, error }),
			)
		: undefined;
	const tagPromise = readExactTag
		? runGit(cwd, ["describe", "--tags", "--exact-match", "HEAD"]).then(
				(out) => out.trim() || null,
				() => null,
			)
		: Promise.resolve(null);
	const metricsPromise = readMetrics
		? runGit(cwd, numstatArgs).then(parseGitNumstat, () => null)
		: Promise.resolve(undefined);

	let gitDir: string;
	try {
		const out = (await gitDirPromise).trim();
		if (!out) throw new Error("empty git dir");
		gitDir = isAbsolute(out) ? out : resolve(cwd, out);
	} catch (error) {
		// Let the other probes settle quietly before returning.
		await Promise.allSettled([statusPromise, tagPromise, metricsPromise]);
		return isNotARepoError(error) ? { kind: "not_a_repo" } : { kind: "error" };
	}

	let status = emptyGitStatus();
	if (statusPromise) {
		const settled = await statusPromise;
		if (!settled.ok) {
			await Promise.allSettled([tagPromise, metricsPromise]);
			return isNotARepoError(settled.error) ? { kind: "not_a_repo" } : { kind: "error" };
		}
		status = settled.value;
	}

	const [tag, metrics] = await Promise.all([tagPromise, metricsPromise]);
	if (status.commit) status.commit = { ...status.commit, tag };
	if (readMetrics) status.metrics = metrics ?? null;
	if (readState) status.gitStateLabel = readGitOperationState(gitDir);
	return { kind: "ok", status };
}
