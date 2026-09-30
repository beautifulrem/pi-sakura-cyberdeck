import { sanitizeDisplayText } from "./extension-status";
import type { GitReadResult, GitStatusSummary } from "./git";
import { emptyGitStatus } from "./git";
import type { PackageVersionReadResult } from "./package-version";
import type { RuntimeReadResult } from "./runtime";
import type { FooterState } from "./state";

function sanitizeOptional(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	return sanitizeDisplayText(value) || undefined;
}

/** Repository-controlled strings (branch, tag) must never carry terminal escapes. */
function sanitizeGitStatus(status: GitStatusSummary): GitStatusSummary {
	return {
		...status,
		branch: sanitizeOptional(status.branch),
		commit: status.commit
			? {
					...status.commit,
					oid: status.commit.oid && /^[0-9a-f]+$/i.test(status.commit.oid) ? status.commit.oid : null,
					tag: status.commit.tag ? (sanitizeDisplayText(status.commit.tag) || null) : null,
				}
			: undefined,
		gitUnavailable: false,
	};
}

/**
 * Apply a project refresh onto footer state. Probes that were skipped are
 * passed as `undefined` and leave their fields untouched (their segments are
 * hidden). On cwd change everything is cleared first; git errors mark the
 * status as unavailable instead of freezing stale counts.
 *
 * Returns the cwd to store as `previousCwd` for the next refresh.
 */
export function applyProjectRefreshToState(
	state: FooterState,
	args: {
		cwd: string;
		previousCwd: string | undefined;
		git?: GitReadResult;
		runtime?: RuntimeReadResult;
		packageVersion?: PackageVersionReadResult;
	},
): string {
	const cwdChanged = args.previousCwd !== undefined && args.previousCwd !== args.cwd;

	if (cwdChanged) {
		Object.assign(state, emptyGitStatus());
		state.runtime = undefined;
		state.packageVersion = undefined;
	}

	if (args.git?.kind === "ok") {
		Object.assign(state, sanitizeGitStatus(args.git.status));
	} else if (args.git?.kind === "not_a_repo") {
		Object.assign(state, emptyGitStatus());
	} else if (args.git?.kind === "error") {
		// Keep the branch name (still meaningful) but never show stale counts as current.
		const branch = state.branch;
		Object.assign(state, emptyGitStatus(), { branch, gitUnavailable: true });
	}

	if (args.runtime?.kind === "ok") {
		const runtime = args.runtime.runtime;
		state.runtime = runtime
			? { ...runtime, version: sanitizeOptional(runtime.version) }
			: undefined;
	}
	// error: keep previous runtime (already cleared above when cwd changed)

	if (args.packageVersion?.kind === "ok") {
		// `null` means "no manifest in this cwd"; clear so the segment disappears.
		state.packageVersion = args.packageVersion.result ?? undefined;
	}
	// error: keep previous packageVersion (last-good semantics)

	return args.cwd;
}
