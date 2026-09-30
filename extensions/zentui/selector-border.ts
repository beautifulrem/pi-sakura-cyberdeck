import {
	DynamicBorder,
	ModelSelectorComponent,
	SettingsSelectorComponent,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { PolishedTuiConfig } from "./config";
import { renderSakuraFrameGradient } from "./gradient";
import { installPrototypePatch } from "./prototype-patch-registry";

/**
 * Recolor the top/bottom DynamicBorder hairlines of Pi's model and settings selectors with the
 * sakura frame gradient. Only rows produced by a DynamicBorder child at the first/last position
 * are touched, and only when they are a plain `─` run; anything else renders stock.
 */

type Cleanup = () => void;
type SelectorLike = { children?: unknown };

const SGR = /\x1b\[[0-9;]*m/g;

function isHairline(line: unknown): boolean {
	if (typeof line !== "string") return false;
	const plain = line.replace(SGR, "");
	return plain.length > 0 && /^─+$/.test(plain);
}

export function patchSelectorBorderStyle(prototype: object): Cleanup {
	return installPrototypePatch(prototype, "render", "selector-border-render", ({ predecessor, receiver, args }) => {
		const rendered = Reflect.apply(predecessor, receiver, args);
		const width = args[0];
		if (!Array.isArray(rendered) || rendered.length < 2 || typeof width !== "number" || width <= 0) {
			return rendered;
		}
		const children = (receiver as SelectorLike).children;
		if (!Array.isArray(children) || children.length < 2) return rendered;
		const firstIsBorder = children[0] instanceof DynamicBorder;
		const lastIsBorder = children[children.length - 1] instanceof DynamicBorder;
		if (!firstIsBorder && !lastIsBorder) return rendered;

		const last = rendered.length - 1;
		const recolorFirst = firstIsBorder && isHairline(rendered[0]);
		const recolorLast = lastIsBorder && isHairline(rendered[last]);
		if (!recolorFirst && !recolorLast) return rendered;
		const lines = [...(rendered as string[])];
		const gradient = renderSakuraFrameGradient("─".repeat(width));
		if (recolorFirst) lines[0] = gradient;
		if (recolorLast) lines[last] = gradient;
		return lines;
	});
}

export function installSelectorBorderStyle(
	_getTheme?: () => Theme | undefined,
	_getConfig?: () => PolishedTuiConfig,
): Cleanup {
	const cleanups = [ModelSelectorComponent.prototype, SettingsSelectorComponent.prototype].map((prototype) =>
		patchSelectorBorderStyle(prototype),
	);
	return () => {
		for (const cleanup of cleanups.reverse()) cleanup();
	};
}
