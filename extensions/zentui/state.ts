import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sanitizeDisplayText } from "./extension-status";
import { formatProviderLabel } from "./format";
import type { GitStatusSummary } from "./git";
import type { PackageVersionResult } from "./package-version";
import type { RuntimeInfo } from "./runtime";

export type FooterState = GitStatusSummary & {
	modelLabel: string;
	providerLabel: string;
	runtime?: RuntimeInfo;
	packageVersion?: PackageVersionResult;
	sessionStartEpoch?: number;
};

export function createInitialState(gitDefaults: GitStatusSummary): FooterState {
	return {
		modelLabel: "no-model",
		providerLabel: "Unknown",
		runtime: undefined,
		packageVersion: undefined,
		sessionStartEpoch: Date.now(),
		...gitDefaults,
	};
}

/** Model/provider labels for the editor meta line. Usage and context are read lazily at render. */
export function syncState(state: FooterState, ctx: Pick<ExtensionContext, "model">): void {
	state.modelLabel = sanitizeDisplayText(ctx.model?.id ?? "") || "no-model";
	state.providerLabel = sanitizeDisplayText(formatProviderLabel(ctx.model?.provider));
}
