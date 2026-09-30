import { getColorMode } from "../shared/color";
import { renderSakuraGradient } from "./gradient";

/**
 * Hidden-thinking label via Pi's public `ctx.ui.setHiddenThinkingLabel` (Pi >= 0.87.1).
 * Visible thinking blocks are left entirely to Pi (toggle, per-run overrides, mouse, markers).
 */

export const SAKURA_HIDDEN_THINKING_LABEL = "✦ Thought";

type HiddenThinkingLabelUi = { setHiddenThinkingLabel?: (label?: string) => void };

export function sakuraThinkingLabel(): string {
	return getColorMode() === "none"
		? SAKURA_HIDDEN_THINKING_LABEL
		: renderSakuraGradient(SAKURA_HIDDEN_THINKING_LABEL);
}

/** Set (or with `enabled = false`, restore Pi's default) hidden-thinking label. No-op if unsupported. */
export function applyThinkingLabel(ctx: { ui?: unknown }, enabled = true): void {
	const ui = ctx.ui as HiddenThinkingLabelUi | undefined;
	if (typeof ui?.setHiddenThinkingLabel !== "function") return;
	try {
		ui.setHiddenThinkingLabel(enabled ? sakuraThinkingLabel() : undefined);
	} catch {
		// Older/alternate hosts: keep Pi's default label.
	}
}
