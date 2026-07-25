import {
	BashExecutionComponent,
	type Theme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
	beautifyToolBody,
	compactToolBody,
	bottomBorder,
	fitBorderLabel,
	formatStats,
	fg,
	stripAnsi,
} from "./tool-body-polish";
import {
	renderBoxedLine,
	renderSakuraFrameGradient,
	renderSakuraGradient,
	renderSakuraSolid,
	rgbForeground,
} from "./gradient";
import { installPrototypePatch } from "./prototype-patch-registry";

const SETTLED_CACHE_MAX_LINES = 80;
const SETTLED_CACHE_MAX_CHARS = 64 * 1024;

// Soft mint for bash rails (truecolor, theme-independent).
const MINT = [174, 229, 197] as const;

type Cleanup = () => void;
type ToolExecutionRuntime = {
	isPartial?: boolean;
	result?: {
		isError?: boolean;
		content?: Array<{ type?: string }>;
	};
	toolName?: string;
	hideComponent?: boolean;
	expanded?: boolean;
	showImages?: boolean;
	getRenderShell?: () => "default" | "self";
};

type SettledRender = {
	width: number;
	result: ToolExecutionRuntime["result"];
	expanded: boolean;
	showImages: boolean;
	lines: string[];
};

function isBlank(line: string): boolean {
	return stripAnsi(line).trim().length === 0;
}

function containsTerminalImage(lines: readonly string[]): boolean {
	return lines.some((line) => line.includes("\x1b_G") || line.includes("\x1b]1337;File="));
}

function containsResultImage(runtime: ToolExecutionRuntime): boolean {
	return runtime.result?.content?.some((item) => item.type === "image") ?? false;
}

function isCacheableSettledRender(lines: readonly string[]): boolean {
	if (lines.length > SETTLED_CACHE_MAX_LINES) return false;
	let chars = 0;
	for (const line of lines) {
		chars += line.length;
		if (chars > SETTLED_CACHE_MAX_CHARS) return false;
	}
	return true;
}

function statusLabel(runtime: ToolExecutionRuntime, statsText: string): string {
	const name = (runtime.toolName || "tool").replaceAll("_", " ").toUpperCase();
	const deltaPart = statsText ? ` · ${statsText}` : "";
	if (runtime.isPartial !== false) return `◆ ${name}${deltaPart} · RUNNING`;
	return runtime.result?.isError
		? `× ${name}${deltaPart} · FAILED`
		: `✓ ${name}${deltaPart} · COMPLETE`;
}

// Status rail = theme semantic tokens from sakura-macaron.json (pastel, not traffic lights).
// Design systems (MUI/Paste/Chakra) keep success/error/info roles; pastel decks soft-tint them.
// This pack: success→mint, error→coral, info→sky (already in theme).
const RAIL_WORKING: [number, number, number] = [159, 211, 242]; // sky  #9FD3F2 — in flight
const RAIL_SUCCESS: [number, number, number] = [174, 229, 197]; // mint  #AEE5C5 — theme success
const RAIL_ERROR: [number, number, number] = [255, 143, 163];   // coral #FF8FA3 — theme error (rose, not pure red)

function leftRailFor(runtime: ToolExecutionRuntime, _theme: Theme): string {
	const pending = runtime.isPartial !== false;
	// Thick left bar: sky / mint / coral — Grok-style status, macaron hues.
	if (pending) return rgbForeground(RAIL_WORKING, "┃ ");
	if (runtime.result?.isError) return rgbForeground(RAIL_ERROR, "┃ ");
	return rgbForeground(RAIL_SUCCESS, "┃ ");
}

/**
 * Compact sakura status rail + modern body polish for tool rows.
 * Settled frames are cached so animation redraws stay cheap.
 */
export function installToolExecutionStyle(getTheme: () => Theme | undefined): Cleanup {
	const settledRenders = new WeakMap<object, SettledRender>();

	const cleanupRenderPatch = installPrototypePatch(
		ToolExecutionComponent.prototype,
		"render",
		"tool-execution-render",
		({ predecessor, receiver, args }) => {
			const width = args[0];
			const runtime = receiver as ToolExecutionRuntime;
			if (
				typeof width === "number" &&
				runtime.isPartial === false &&
				!runtime.hideComponent &&
				!containsResultImage(runtime)
			) {
				const cached = settledRenders.get(receiver as object);
				if (
					cached?.width === width &&
					cached.result === runtime.result &&
					cached.expanded === Boolean(runtime.expanded) &&
					cached.showImages === Boolean(runtime.showImages)
				) {
					return cached.lines;
				}
			}

			const rendered = Reflect.apply(predecessor, receiver, args);
			if (!Array.isArray(rendered) || !rendered.every((line) => typeof line === "string")) {
				return rendered;
			}
			const lines = rendered as string[];
			if (
				typeof width !== "number" ||
				width <= 2 ||
				lines.length === 0 ||
				runtime.hideComponent ||
				runtime.getRenderShell?.() === "self" ||
				containsTerminalImage(lines)
			) {
				return lines;
			}

			const theme = getTheme();
			if (!theme) return lines;
			const pending = runtime.isPartial !== false;

			const prefix: string[] = [];
			const body = [...lines];
			if (body[0] !== undefined && isBlank(body[0])) {
				const blank = body.shift();
				if (blank !== undefined) prefix.push(blank);
			}

			const polished = beautifyToolBody(body, theme);
			const bodyLines = compactToolBody(polished.lines, {
				expanded: Boolean(runtime.expanded),
				theme,
			});
			const statsText = formatStats(polished.stats);
			const label = fitBorderLabel(statusLabel(runtime, statsText), width);
			const top = renderSakuraFrameGradient(label);
			const leftRail = leftRailFor(runtime, theme);
			const rightRail = renderSakuraSolid(" │"); // same sakura as left corner
			const bottom = renderSakuraFrameGradient(bottomBorder(width));
			const boxed = [
				...prefix,
				top,
				...bodyLines.map((line) => renderBoxedLine(line, width, leftRail, rightRail)),
				bottom,
			];
			if (!pending && !containsResultImage(runtime) && isCacheableSettledRender(boxed)) {
				settledRenders.set(receiver as object, {
					width,
					result: runtime.result,
					expanded: Boolean(runtime.expanded),
					showImages: Boolean(runtime.showImages),
					lines: boxed,
				});
			}
			return boxed;
		},
	);

	const cleanupInvalidatePatch = installPrototypePatch(
		ToolExecutionComponent.prototype,
		"invalidate",
		"tool-execution-invalidate",
		({ predecessor, receiver, args }) => {
			settledRenders.delete(receiver as object);
			return Reflect.apply(predecessor, receiver, args);
		},
	);

	// Bash uses its own component — gradient the chrome, keep streaming body.
	const cleanupBashRender = installPrototypePatch(
		BashExecutionComponent.prototype,
		"render",
		"bash-execution-render",
		({ predecessor, receiver, args }) => {
			const width = args[0];
			const rendered = Reflect.apply(predecessor, receiver, args);
			if (!Array.isArray(rendered) || !rendered.every((line) => typeof line === "string")) {
				return rendered;
			}
			const lines = rendered as string[];
			if (typeof width !== "number" || width <= 2 || lines.length === 0) return lines;

			const plains = lines.map(stripAnsi);
			const isRunning = plains.some((p) => p.includes("Running..."));
			const out: string[] = [];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i] ?? "";
				const plain = plains[i] ?? "";
				const trimmed = plain.trim();

				// Top / bottom DynamicBorder → sakura gradient frame.
				if (/^[╭┌╔].*[╮┐╗]$/.test(trimmed) || /^[─═]{3,}$/.test(trimmed)) {
					const label = isRunning ? "◆ BASH · RUNNING" : "✓ BASH · COMPLETE";
					out.push(renderSakuraFrameGradient(fitBorderLabel(label, width)));
					continue;
				}
				if (/^[╰└╚].*[╯┘╝]$/.test(trimmed)) {
					out.push(renderSakuraFrameGradient(bottomBorder(width)));
					continue;
				}

				// Command header: `$ cmd` → mint prompt.
				const cmd = trimmed.match(/^\$\s+(.+)$/);
				if (cmd) {
					out.push(`${fg(MINT, "❯")} ${fg([159, 211, 242], cmd[1] ?? "")}`);
					continue;
				}

				out.push(line);
			}

			// Cap bash stream paint when collapsed (Pi expanded flag not on BashExecution;
			// keep last N lines so live tail still useful).
			const BASH_COLLAPSED = 16;
			if (out.length > BASH_COLLAPSED + 4) {
				const head = out.slice(0, 3); // borders/header-ish
				const tail = out.slice(-BASH_COLLAPSED);
				const more = out.length - head.length - tail.length;
				if (more > 0) {
					return [
						...head,
						fg([113, 104, 121], `… +${more} lines`),
						...tail,
					];
				}
			}
			return out;
		},
	);

	return () => {
		cleanupBashRender();
		cleanupInvalidatePatch();
		cleanupRenderPatch();
	};
}
