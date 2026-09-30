import { type Theme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { getColorMode, paintFg, type RGB } from "../shared/color";
import { renderSakuraFrameGradient } from "./gradient";
import { installPrototypePatch } from "./prototype-patch-registry";

/**
 * Tool card chrome: sakura gradient title frame + status rail around Pi's own tool rendering.
 *
 * Body lines are Pi's render output at `width - 3` columns, passed through byte-for-byte: the
 * pack never rewrites, strips or truncates tool output. Tools that draw their own shell
 * (`renderShell: "self"`, e.g. edit), image results, and hidden cards stay fully stock.
 */

type Cleanup = () => void;
type ToolStatus = "running" | "ok" | "error";

/** Private ToolExecutionComponent fields read defensively (present in Pi 0.87.1 and 0.99.1). */
type ToolExecutionRuntime = {
	isPartial?: unknown;
	result?: { isError?: unknown; content?: unknown };
	toolName?: unknown;
	expanded?: unknown;
	hideComponent?: unknown;
	getRenderShell?: unknown;
};

type MouseEventLike = { x: number; y: number; width: number; height: number };

type CardRender = {
	width: number;
	innerWidth: number;
	status: ToolStatus;
	expanded: boolean;
	name: string;
	colorMode: string;
	/** Number of leading inner lines kept outside the frame (Pi's spacer row). */
	prefix: number;
	inner: readonly string[];
	lines: string[];
};

// Theme-independent status hues (sakura-macaron.json roles): sky = running, mint = ok, coral = error.
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

/** Stock rendering for shells we do not frame (self-rendered tools, images, hidden cards). */
function isFrameable(runtime: ToolExecutionRuntime): boolean {
	if (runtime.hideComponent === true) return false;
	if (typeof runtime.getRenderShell === "function") {
		try {
			if ((runtime.getRenderShell as () => unknown).call(runtime) === "self") return false;
		} catch {
			return false;
		}
	}
	return !hasImageResult(runtime);
}

function statusText(status: ToolStatus, name: string): string {
	if (status === "running") return `◆ ${name} · RUNNING`;
	if (status === "error") return `× ${name} · FAILED`;
	return `✓ ${name}`;
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
): { lines: string[]; prefix: number } {
	const prefix = inner[0] === "" ? 1 : 0; // Pi's Spacer(1) row stays above the frame
	const left = paintFg(STATUS_RGB[status], LEFT_RAIL);
	const right = paintFg(FRAME_RGB, RIGHT_RAIL);
	const lines: string[] = inner.slice(0, prefix);
	lines.push(renderSakuraFrameGradient(frameTop(statusText(status, name), width)));
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

export function installToolExecutionStyle(_getTheme?: () => Theme | undefined): Cleanup {
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
			const cached = cards.get(receiver as object);
			if (
				cached &&
				cached.width === width &&
				cached.status === status &&
				cached.expanded === expanded &&
				cached.name === name &&
				cached.colorMode === colorMode &&
				sameLines(cached.inner, lines)
			) {
				return cached.lines;
			}

			const card = buildCard(lines, width, status, name);
			cards.set(receiver as object, {
				width,
				innerWidth,
				status,
				expanded,
				name,
				colorMode,
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
