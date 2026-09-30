// Pack-unique key: upstream pi-zentui uses "pi-zentui.prototype-patch-registry"; sharing it
// would let the two packages clobber each other's records when both are installed.
export const ZENTUI_PROTOTYPE_PATCH_REGISTRY = Symbol.for(
	"pi-sakura-cyberdeck.zentui.prototype-patch-registry",
);

export type PrototypePatchAdapter =
	| "user-message-render"
	| "selector-border-render"
	| "tool-execution-render"
	| "tool-execution-mouse";

export type PrototypeMethodName = "render" | "handleMouse";
type PrototypeMethod = (this: unknown, ...args: unknown[]) => unknown;

export type PatchInvocation = {
	predecessor: PrototypeMethod;
	receiver: unknown;
	args: unknown[];
};

export type PatchBehavior = (invocation: PatchInvocation) => unknown;

type Registration = {
	token: symbol;
	behavior?: PatchBehavior;
};

type PatchRecord = {
	method: PrototypeMethodName;
	/** True when the method was an own property of the target before we wrapped it. */
	hadOwn: boolean;
	/** Own predecessor; unused when `hadOwn` is false (resolved through the prototype chain per call). */
	predecessor?: PrototypeMethod;
	wrapper: PrototypeMethod;
	registration?: Registration;
};

type PatchRegistry = Map<PrototypePatchAdapter, PatchRecord>;
type PatchTarget = Record<PropertyKey, unknown>;

function ownRegistry(target: PatchTarget): PatchRegistry | undefined {
	// Own-property lookup only: a parent prototype's registry must never be reused.
	if (!Object.prototype.hasOwnProperty.call(target, ZENTUI_PROTOTYPE_PATCH_REGISTRY)) return undefined;
	const existing = target[ZENTUI_PROTOTYPE_PATCH_REGISTRY];
	return existing instanceof Map ? (existing as PatchRegistry) : undefined;
}

function registryFor(target: PatchTarget): PatchRegistry {
	const existing = ownRegistry(target);
	if (existing) return existing;
	const registry: PatchRegistry = new Map();
	Object.defineProperty(target, ZENTUI_PROTOTYPE_PATCH_REGISTRY, {
		value: registry,
		configurable: true,
	});
	return registry;
}

function isReusable(record: PatchRecord | undefined, method: PrototypeMethodName): record is PatchRecord {
	return (
		record !== undefined &&
		record.method === method &&
		typeof record.wrapper === "function" &&
		typeof record.hadOwn === "boolean"
	);
}

function resolvePredecessor(target: PatchTarget, record: PatchRecord): PrototypeMethod | undefined {
	if (record.hadOwn) return record.predecessor;
	// Inherited method: look it up on the parent each call so later patches to the parent
	// (e.g. Container.prototype.render) stay visible through our wrapper.
	const parent = Object.getPrototypeOf(target) as PatchTarget | null;
	const inherited = parent?.[record.method];
	return typeof inherited === "function" ? (inherited as PrototypeMethod) : undefined;
}

function createWrapper(target: PatchTarget, record: PatchRecord): PrototypeMethod {
	return function sakuraPrototypeWrapper(this: unknown, ...args: unknown[]): unknown {
		const predecessor = resolvePredecessor(target, record);
		if (!predecessor) return undefined;
		const behavior = record.registration?.behavior;
		if (!behavior) return Reflect.apply(predecessor, this, args);
		return behavior({ predecessor, receiver: this, args });
	};
}

function restore(target: PatchTarget, registry: PatchRegistry, adapter: PrototypePatchAdapter, record: PatchRecord): void {
	if (target[record.method] !== record.wrapper) {
		// Someone wrapped on top of us: removing our wrapper would cut them off. Leave it in the
		// chain as a passthrough and keep the record so a later install reuses it (no stacking).
		return;
	}
	if (record.hadOwn) target[record.method] = record.predecessor;
	else delete target[record.method];
	registry.delete(adapter);
	if (registry.size === 0) delete target[ZENTUI_PROTOTYPE_PATCH_REGISTRY];
}

/**
 * Wrap `target[method]` once per adapter and route calls to `behavior` until the returned cleanup runs.
 * Reinstalling reuses the existing wrapper (also when another extension wrapped on top of it), so
 * repeated session starts never stack wrappers. Cleanup restores the original own method, or deletes
 * the own property when the method was inherited.
 */
export function installPrototypePatch(
	targetValue: object,
	method: PrototypeMethodName,
	adapter: PrototypePatchAdapter,
	behavior: PatchBehavior,
): () => void {
	const target = targetValue as PatchTarget;
	const registry = registryFor(target);
	let record = registry.get(adapter);

	if (!isReusable(record, method)) {
		const current = target[method];
		if (typeof current !== "function") {
			if (registry.size === 0) delete target[ZENTUI_PROTOTYPE_PATCH_REGISTRY];
			throw new TypeError(`Cannot patch ${method}: predecessor is not a function`);
		}
		const hadOwn = Object.prototype.hasOwnProperty.call(target, method);
		const next: PatchRecord = {
			method,
			hadOwn,
			predecessor: hadOwn ? (current as PrototypeMethod) : undefined,
			wrapper: () => undefined,
		};
		next.wrapper = createWrapper(target, next);
		registry.set(adapter, next);
		target[method] = next.wrapper;
		record = next;
	}

	const active = record;
	const token = Symbol(adapter);
	active.registration = { token, behavior };
	let cleaned = false;
	return () => {
		if (cleaned) return;
		cleaned = true;
		if (active.registration?.token !== token) return;
		active.registration = undefined;
		if (registry.get(adapter) === active) restore(target, registry, adapter, active);
	};
}
