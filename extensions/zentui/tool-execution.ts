import { type Theme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { getColorMode, paintFg, type RGB } from "../shared/color";
import { renderSakuraFrameGradient } from "./gradient";
import { installPrototypePatch } from "./prototype-patch-registry";
import { safeThemeFg } from "./style";

/**
 * Tool card chrome: sakura gradient title frame + status rail around Pi's own tool rendering.
 *
 * Body lines are Pi's render output at `width - 3` columns, passed through byte-for-byte: the
 * pack never rewrites, strips or truncates tool output. Hidden cards and image results stay stock
 * (a frame around an image row would be meaningless); `renderShell: "self"` tools such as `edit`
 * are framed like any other.
 *
 * Why a component hook instead of `pi.registerToolRenderer()`: that API selects a tool's own
 * `renderShell`/`renderCall`/`renderResult`, which draws the *inside* of the tool row. This card
 * frames the whole rendered row (Pi's box, title and status) and remaps mouse hit-testing to it,
 * so it has to hook `ToolExecutionComponent` itself. The hook is registered through
 * `installPrototypePatch` (idempotent, removable, shielded from other Zentui forks).
 */

type Cleanup = () => void;
type ToolStatus = "running" | "ok" | "error";

/** Private ToolExecutionComponent fields read defensively (present in Pi 0.87.1 and 0.99.1). */
type ToolExecutionRuntime = {
	isPartial?: unknown;
	result?: { isError?: unknown; content?: unknown; details?: unknown };
	toolName?: unknown;
	expanded?: unknown;
	hideComponent?: unknown;
};

type MouseEventLike = { x: number; y: number; width: number; height: number };

type CardRender = {
	width: number;
	innerWidth: number;
	status: ToolStatus;
	expanded: boolean;
	name: string;
	colorMode: string;
	statusStyle: string;
	added: number;
	removed: number;
	/** Number of leading inner lines kept outside the frame (Pi's spacer row). */
	prefix: number;
	inner: readonly string[];
	lines: string[];
};

// Fallback only when no active theme is available. Semantic status follows Pi's theme.
const STATUS_RGB: Record<ToolStatus, RGB> = {
	running: [159, 211, 242],
	ok: [174, 229, 197],
	error: [255, 143, 163],
};
const FRAME_RGB: RGB = [242, 167, 198];
const LEFT_RAIL = "┃ ";
const RIGHT_RAIL = "│";
const LEFT_COLUMNS = 2; // visible width of LEFT_RAIL
const RAIL_COLUMNS = 3; // visible width of LEFT_RAIL + RIGHT_RAIL
const MIN_WIDTH = 12;

function toolStatus(runtime: ToolExecutionRuntime): ToolStatus | undefined {
	if (typeof runtime.isPartial !== "boolean") return undefined; // unknown shape: stay stock
	if (runtime.isPartial) return "running";
	return runtime.result?.isError === true ? "error" : "ok";
}

function toolLabelName(runtime: ToolExecutionRuntime): string {
	const raw = typeof runtime.toolName === "string" && runtime.toolName ? runtime.toolName : "tool";
	// Chrome only (never body content): drop control characters so the frame cannot be corrupted.
	return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replaceAll("_", " ").toUpperCase();
}

function hasImageResult(runtime: ToolExecutionRuntime): boolean {
	const content = runtime.result?.content;
	if (!Array.isArray(content)) return false;
	return content.some((item) => (item as { type?: unknown } | null)?.type === "image");
}

/**
 * Stock rendering only where a frame cannot work: hidden cards and image results.
 *
 * `renderShell: "self"` tools (e.g. `edit`, which renders its own diff) are framed too — Pi's
 * self-shell render is `["", ...content]`, which the card's `prefix` handling already accounts
 * for, and the card draws rails rather than a second box.
 */
function isFrameable(runtime: ToolExecutionRuntime): boolean {
	if (runtime.hideComponent === true) return false;
	return !hasImageResult(runtime);
}

export type DiffStats = { added: number; removed: number };

/**
 * `+N −M` from the tool result's own unified diff (`result.details.diff`, as Pi's edit tool
 * provides). Read, never rewritten — unlike counting markers in the rendered body.
 */
export function diffStats(diff: string | undefined): DiffStats | undefined {
	if (typeof diff !== "string" || !diff) return undefined;
	let added = 0;
	let removed = 0;
	let oldLeft = 0;
	let newLeft = 0;
	for (const line of diff.split("\n")) {
		const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk) {
			oldLeft = Number(hunk[2] ?? 1);
			newLeft = Number(hunk[4] ?? 1);
			continue;
		}
		const inHunk = oldLeft > 0 || newLeft > 0;
		if (!inHunk && (line.startsWith("+++") || line.startsWith("---"))) continue;
		if (line.startsWith("+")) { added += 1; newLeft = Math.max(0, newLeft - 1); }
		else if (line.startsWith("-")) { removed += 1; oldLeft = Math.max(0, oldLeft - 1); }
		else if (line.startsWith(" ")) { oldLeft = Math.max(0, oldLeft - 1); newLeft = Math.max(0, newLeft - 1); }
	}
	return added || removed ? { added, removed } : undefined;
}

function statsSuffix(stats: DiffStats | undefined): string {
	if (!stats) return "";
	const parts: string[] = [];
	if (stats.added > 0) parts.push(`+${stats.added}`);
	if (stats.removed > 0) parts.push(`−${stats.removed}`);
	return parts.length ? ` · ${parts.join(" ")}` : "";
}

function statusText(status: ToolStatus, name: string, stats: DiffStats | undefined): string {
	const tail = statsSuffix(stats);
	if (status === "running") return `◆ ${name}${tail} · RUNNING`;
	if (status === "error") return `× ${name}${tail} · FAILED`;
	return `✓ ${name}${tail} · COMPLETE`;
}

/** `╭─ label ───╮` fitted to exactly `width` cells (label clipped per character, no ellipsis). */
export function frameTop(label: string, width: number): string {
	if (width <= 1) return width === 1 ? "╭" : "";
	const inner = width - 2;
	let used = 0;
	let text = "";
	for (const char of `─ ${label} `) {
		const w = visibleWidth(char);
		if (used + w > inner) break;
		text += char;
		used += w;
	}
	return `╭${text}${"─".repeat(inner - used)}╮`;
}

export function frameBottom(width: number): string {
	if (width <= 1) return width === 1 ? "╰" : "";
	return `╰${"─".repeat(width - 2)}╯`;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	// Pi's Box/Text caches return the same string objects every frame, so this is an identity scan.
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function buildCard(
	inner: readonly string[],
	width: number,
	status: ToolStatus,
	name: string,
	stats: DiffStats | undefined,
	theme: Theme | undefined,
): { lines: string[]; prefix: number } {
	const prefix = inner[0] === "" ? 1 : 0; // Pi's Spacer(1) row stays above the frame
	const role = status === "error" ? "error" : status === "ok" ? "success" : "toolTitle";
	const left = theme ? safeThemeFg(theme, role, LEFT_RAIL) : paintFg(STATUS_RGB[status], LEFT_RAIL);
	const right = paintFg(FRAME_RGB, RIGHT_RAIL);
	const lines: string[] = inner.slice(0, prefix);
	const label = statusText(status, name, stats);
	const top = frameTop(label, width);
	lines.push(theme
		? top.includes(label)
			? renderSakuraFrameGradient(top.slice(0, 3)) + safeThemeFg(theme, role, label) + renderSakuraFrameGradient(top.slice(3 + label.length))
			: safeThemeFg(theme, role, top)
		: renderSakuraFrameGradient(top));
	for (let i = prefix; i < inner.length; i++) lines.push(`${left}${inner[i]}${right}`);
	lines.push(renderSakuraFrameGradient(frameBottom(width)));
	return { lines, prefix };
}

/**
 * Map a mouse event on the framed card back to Pi's own layout (inner width, rows without the
 * frame). Returns undefined for frame/rail cells.
 */
export function mapCardMouseEvent<T extends MouseEventLike>(event: T, card: CardRender): T | undefined {
	const { prefix, inner } = card;
	const bodyEnd = prefix + 1 + (inner.length - prefix); // exclusive row index of the body
	let y: number;
	if (event.y < prefix) y = event.y;
	else if (event.y > prefix && event.y < bodyEnd) y = event.y - 1;
	else return undefined;
	const x = event.x - LEFT_COLUMNS;
	if (x < 0 || x >= card.innerWidth) return undefined; // rail cells
	return { ...event, y, x, width: card.innerWidth, height: inner.length };
}

export function installToolExecutionStyle(getTheme?: () => Theme | undefined): Cleanup {
	const cards = new WeakMap<object, CardRender>();

	const cleanupRender = installPrototypePatch(
		ToolExecutionComponent.prototype,
		"render",
		"tool-execution-render",
		({ predecessor, receiver, args }) => {
			const width = args[0];
			const runtime = receiver as ToolExecutionRuntime;
			const status = toolStatus(runtime);
			if (
				typeof width !== "number" ||
				width < MIN_WIDTH ||
				status === undefined ||
				!isFrameable(runtime)
			) {
				cards.delete(receiver as object);
				return Reflect.apply(predecessor, receiver, args);
			}

			const innerWidth = width - RAIL_COLUMNS;
			const inner = Reflect.apply(predecessor, receiver, [innerWidth, ...args.slice(1)]);
			if (!Array.isArray(inner) || inner.length === 0) {
				cards.delete(receiver as object);
				return inner;
			}

			const lines = inner as string[];
			const expanded = runtime.expanded === true;
			const name = toolLabelName(runtime);
			const colorMode = getColorMode();
			const theme = getTheme?.();
			const role = status === "error" ? "error" : status === "ok" ? "success" : "toolTitle";
			const statusStyle = theme ? safeThemeFg(theme, role, "x") : "";
			const details = runtime.result?.details as { diff?: unknown } | undefined;
			const stats = diffStats(typeof details?.diff === "string" ? details.diff : undefined);
			const cached = cards.get(receiver as object);
			if (
				cached &&
				cached.width === width &&
				cached.status === status &&
				cached.expanded === expanded &&
				cached.name === name &&
				cached.colorMode === colorMode &&
				cached.statusStyle === statusStyle &&
				cached.added === (stats?.added ?? 0) &&
				cached.removed === (stats?.removed ?? 0) &&
				sameLines(cached.inner, lines)
			) {
				return cached.lines;
			}

			const card = buildCard(lines, width, status, name, stats, theme);
			cards.set(receiver as object, {
				width,
				innerWidth,
				status,
				expanded,
				name,
				colorMode,
				statusStyle,
				added: stats?.added ?? 0,
				removed: stats?.removed ?? 0,
				prefix: card.prefix,
				inner: lines,
				lines: card.lines,
			});
			return card.lines;
		},
	);

	// Fullscreen click-to-expand: Pi hit-tests with its own row/column layout, so translate
	// events from the framed card back to it (skip the title row, strip the rail columns).
	const cleanupMouse = installPrototypePatch(
		ToolExecutionComponent.prototype,
		"handleMouse",
		"tool-execution-mouse",
		({ predecessor, receiver, args }) => {
			const event = args[0] as MouseEventLike | undefined;
			const card = cards.get(receiver as object);
			if (
				!card ||
				!event ||
				typeof event.x !== "number" ||
				typeof event.y !== "number" ||
				event.width !== card.width
			) {
				return Reflect.apply(predecessor, receiver, args);
			}
			const mapped = mapCardMouseEvent(event, card);
			if (!mapped) return undefined;
			return Reflect.apply(predecessor, receiver, [mapped, ...args.slice(1)]);
		},
	);

	return () => {
		cleanupMouse();
		cleanupRender();
	};
}
