import type { PolishedTuiConfig } from "./config";
import type { ReadGitStatusOptions } from "./git";

export type StopProjectRefreshInterval = () => void;

export type ScheduleProjectRefreshOptions = {
	force?: boolean;
};

export type ProjectRefreshScheduler<T> = {
	schedule: (target: T, options?: ScheduleProjectRefreshOptions) => void;
	stop: () => void;
};

const PROJECT_REFRESH_THROTTLE_MS = 5_000;

export function startProjectRefreshInterval(
	intervalMs: number,
	refresh: () => void,
): StopProjectRefreshInterval {
	if (intervalMs <= 0) return () => {};

	const timer = setInterval(refresh, intervalMs);
	timer.unref?.();

	return () => clearInterval(timer);
}

export function createProjectRefreshScheduler<T>(
	refresh: (target: T) => Promise<void>,
	afterRefresh: () => void,
	throttleMs = PROJECT_REFRESH_THROTTLE_MS,
): ProjectRefreshScheduler<T> {
	let refreshInFlight = false;
	let refreshPending = false;
	let pendingTarget: T | undefined;
	let delayedRefresh: ReturnType<typeof setTimeout> | undefined;
	let lastRefreshStartedAt: number | undefined;
	let generation = 0;

	const clearDelayedRefresh = () => {
		if (!delayedRefresh) return;
		clearTimeout(delayedRefresh);
		delayedRefresh = undefined;
	};

	const runRefresh = (target: T) => {
		clearDelayedRefresh();
		if (refreshInFlight) {
			refreshPending = true;
			pendingTarget = target;
			return;
		}

		const currentGeneration = generation;
		refreshInFlight = true;
		lastRefreshStartedAt = Date.now();
		void refresh(target)
			.catch(() => undefined)
			.finally(() => {
				if (currentGeneration !== generation) return;
				refreshInFlight = false;
				afterRefresh();
				if (refreshPending) {
					refreshPending = false;
					const nextTarget = pendingTarget ?? target;
					pendingTarget = undefined;
					schedule(nextTarget);
				}
			});
	};

	const schedule = (target: T, options: ScheduleProjectRefreshOptions = {}) => {
		if (options.force || throttleMs <= 0 || lastRefreshStartedAt === undefined) {
			runRefresh(target);
			return;
		}

		const delayMs = Math.max(0, throttleMs - (Date.now() - lastRefreshStartedAt));
		if (delayMs === 0) {
			runRefresh(target);
			return;
		}

		pendingTarget = target;
		if (delayedRefresh) return;
		delayedRefresh = setTimeout(() => {
			delayedRefresh = undefined;
			const nextTarget = pendingTarget ?? target;
			pendingTarget = undefined;
			runRefresh(nextTarget);
		}, delayMs);
		delayedRefresh.unref?.();
	};

	return {
		schedule,
		stop() {
			generation += 1;
			clearDelayedRefresh();
			refreshInFlight = false;
			refreshPending = false;
			pendingTarget = undefined;
			lastRefreshStartedAt = undefined;
		},
	};
}

export type ProjectProbePlan = {
	/** Git probes to run; `undefined` = no git subprocess at all. */
	git?: ReadGitStatusOptions;
	runtime: boolean;
	packageVersion: boolean;
	/** Wall-clock label (HH:MM) visible → tick on minute boundaries. */
	clock: boolean;
	/** Session duration visible → tick when the label changes. */
	duration: boolean;
};

function formatUses(format: string, names: string): boolean {
	return new RegExp(`\\$\\{?(?:${names})\\b`).test(format);
}

/**
 * Decide which probes/timers the visible footer actually needs. A non-empty
 * `footerFormat` replaces the segment layout entirely, so only its variables count.
 * The branch name itself comes from Pi's footer data provider (no subprocess).
 */
export function planProjectProbes(config: PolishedTuiConfig): ProjectProbePlan {
	const format = config.footerFormat;
	const segments = config.footerSegments;
	const visible = format
		? {
				status: formatUses(format, "git_status|status"),
				state: formatUses(format, "git_state|state"),
				commit: formatUses(format, "git_commit|commit"),
				tag: formatUses(format, "git_tag|tag"),
				metrics: formatUses(format, "git_metrics|git_added|git_deleted"),
				runtime: formatUses(format, "runtime"),
				packageVersion: formatUses(format, "package|package_version"),
				clock: formatUses(format, "time"),
				duration: formatUses(format, "session_duration|duration"),
			}
		: {
				status: segments.gitStatus,
				state: segments.gitBranch || segments.gitStatus,
				commit: segments.gitCommit,
				tag: false,
				metrics: segments.gitMetrics,
				runtime: segments.runtime,
				packageVersion: segments.packageVersion,
				clock: segments.time,
				duration: segments.sessionDuration,
			};
	const git: ReadGitStatusOptions = {
		readStatus: visible.status || visible.commit,
		readState: visible.state,
		readExactTag: visible.tag || (visible.commit && config.gitCommit.showTag),
		readMetrics: visible.metrics,
		ignoreSubmodules: config.gitMetrics.ignoreSubmodules,
	};
	const needsGit = git.readStatus || git.readState || git.readExactTag || git.readMetrics;
	return {
		git: needsGit ? git : undefined,
		runtime: visible.runtime,
		packageVersion: visible.packageVersion,
		clock: visible.clock,
		duration: visible.duration,
	};
}
