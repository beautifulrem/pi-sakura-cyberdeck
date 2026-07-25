import {
	ModelSelectorComponent,
	SettingsSelectorComponent,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { PolishedTuiConfig } from "./config";
import { installPrototypePatch } from "./prototype-patch-registry";
import { renderSakuraFrameGradient } from "./gradient";

type PatchableSelectorPrototype = {
	render: (width: number) => string[];
};

type Cleanup = () => void;

function stripAnsi(text: string): string {
	return text.replaceAll(/\x1b\[[0-9;]*m/g, "");
}

function isHorizontalBorderLine(line: string): boolean {
	return /^─+$/.test(stripAnsi(line));
}

function renderBorderLine(
	width: number,
	_theme: Theme | undefined,
	_config: PolishedTuiConfig | undefined,
): string {
	const text = "─".repeat(Math.max(1, width));
	return renderSakuraFrameGradient(text);
}

export function patchSelectorBorderStyle(
	prototype: PatchableSelectorPrototype,
	getTheme?: () => Theme | undefined,
	getConfig?: () => PolishedTuiConfig,
): Cleanup {
	return installPrototypePatch(
		prototype,
		"render",
		"selector-border-render",
		({ predecessor, receiver, args }) => {
			const lines = Reflect.apply(predecessor, receiver, args) as string[];
			const width = args[0];
			if (lines.length === 0 || typeof width !== "number" || width <= 0) return lines;

			return lines.map((line, index) => {
				if (index !== 0 && index !== lines.length - 1) return line;
				if (!isHorizontalBorderLine(line)) return line;
				return renderBorderLine(width, getTheme?.(), getConfig?.());
			});
		},
	);
}

export function installSelectorBorderStyle(
	getTheme?: () => Theme | undefined,
	getConfig?: () => PolishedTuiConfig,
): Cleanup {
	const cleanupModel = patchSelectorBorderStyle(
		ModelSelectorComponent.prototype as unknown as PatchableSelectorPrototype,
		getTheme,
		getConfig,
	);
	const cleanupSettings = patchSelectorBorderStyle(
		SettingsSelectorComponent.prototype as unknown as PatchableSelectorPrototype,
		getTheme,
		getConfig,
	);
	return () => {
		cleanupModel();
		cleanupSettings();
	};
}
