import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelSelectorComponent, SettingsSelectorComponent } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import {
	installPrototypePatch,
	ZENTUI_PROTOTYPE_PATCH_REGISTRY,
} from "../extensions/zentui/prototype-patch-registry";
import { installSelectorBorderStyle } from "../extensions/zentui/selector-border";

const has = (target: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(target, key);

function makeClasses() {
	class Base {
		render(): unknown {
			return "base";
		}
	}
	class Child extends Base {}
	class Own extends Base {
		override render(): unknown {
			return "own";
		}
	}
	return { Base, Child, Own };
}

test("registry key is pack-unique (does not collide with upstream pi-zentui)", () => {
	assert.notEqual(ZENTUI_PROTOTYPE_PATCH_REGISTRY, Symbol.for("pi-zentui.prototype-patch-registry"));
	const { Own } = makeClasses();
	const upstream = new Map([["tool-execution-render", { sentinel: true }]]);
	Object.defineProperty(Own.prototype, Symbol.for("pi-zentui.prototype-patch-registry"), {
		value: upstream,
		configurable: true,
	});
	const cleanup = installPrototypePatch(Own.prototype, "render", "tool-execution-render", () => "patched");
	assert.equal(new Own().render(), "patched");
	cleanup();
	assert.equal(new Own().render(), "own");
	assert.equal(upstream.size, 1);
});

test("own method: patch and restore the original function", () => {
	const { Own } = makeClasses();
	const original = Own.prototype.render;
	const cleanup = installPrototypePatch(Own.prototype, "render", "tool-execution-render", ({ predecessor, receiver }) =>
		`${String(predecessor.call(receiver))}!`,
	);
	assert.equal(new Own().render(), "own!");
	cleanup();
	assert.equal(Own.prototype.render, original);
	assert.ok(has(Own.prototype, "render"));
	assert.ok(!has(Own.prototype, ZENTUI_PROTOTYPE_PATCH_REGISTRY));
});

test("inherited method: unpatch deletes the own copy so later parent patches stay visible", () => {
	const { Base, Child } = makeClasses();
	assert.ok(!has(Child.prototype, "render"));
	const cleanup = installPrototypePatch(Child.prototype, "render", "selector-border-render", ({ predecessor, receiver }) =>
		`child(${String(predecessor.call(receiver))})`,
	);
	assert.equal(new Child().render(), "child(base)");

	// A parent patch installed while the child is wrapped is seen through the wrapper.
	const baseRender = Base.prototype.render;
	Base.prototype.render = function () {
		return "base2";
	};
	assert.equal(new Child().render(), "child(base2)");

	cleanup();
	assert.ok(!has(Child.prototype, "render"), "no own render left behind");
	assert.equal(new Child().render(), "base2");
	Base.prototype.render = baseRender;
	assert.equal(new Child().render(), "base");
});

test("registry lookup is own-property only (parent registry is never reused)", () => {
	const { Base, Child } = makeClasses();
	const cleanupBase = installPrototypePatch(Base.prototype, "render", "selector-border-render", () => "B");
	const cleanupChild = installPrototypePatch(Child.prototype, "render", "selector-border-render", ({ predecessor, receiver }) =>
		`C${String(predecessor.call(receiver))}`,
	);
	assert.ok(has(Child.prototype, ZENTUI_PROTOTYPE_PATCH_REGISTRY));
	assert.notEqual(
		(Child.prototype as unknown as Record<PropertyKey, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY],
		(Base.prototype as unknown as Record<PropertyKey, unknown>)[ZENTUI_PROTOTYPE_PATCH_REGISTRY],
	);
	assert.equal(new Child().render(), "CB");
	cleanupBase();
	assert.equal(new Child().render(), "Cbase");
	cleanupChild();
	assert.equal(new Child().render(), "base");
	assert.ok(!has(Child.prototype, "render"));
});

test("reinstall is idempotent when another extension wrapped on top", () => {
	const { Own } = makeClasses();
	let cleanup = installPrototypePatch(Own.prototype, "render", "tool-execution-render", ({ predecessor, receiver }) =>
		`${String(predecessor.call(receiver))}!`,
	);
	const ours = Own.prototype.render;
	const foreign = function (this: unknown) {
		return `x:${String(ours.call(this))}`;
	};
	Own.prototype.render = foreign;
	assert.equal(new Own().render(), "x:own!");

	for (let session = 0; session < 3; session++) {
		cleanup();
		assert.equal(Own.prototype.render, foreign, "foreign wrapper kept intact");
		assert.equal(new Own().render(), "x:own", "our buried wrapper is a passthrough");
		cleanup = installPrototypePatch(Own.prototype, "render", "tool-execution-render", ({ predecessor, receiver }) =>
			`${String(predecessor.call(receiver))}!`,
		);
		assert.equal(Own.prototype.render, foreign, "no new wrapper stacked on top");
		assert.equal(new Own().render(), "x:own!", "exactly one active behavior");
	}
	cleanup();
	// Once the foreign wrapper is gone, the next install/uninstall cycle restores cleanly.
	Own.prototype.render = ours;
	cleanup = installPrototypePatch(Own.prototype, "render", "tool-execution-render", () => "p");
	assert.equal(new Own().render(), "p");
	cleanup();
	assert.equal(new Own().render(), "own");
	assert.ok(!has(Own.prototype, ZENTUI_PROTOTYPE_PATCH_REGISTRY));
});

test("stale cleanup after reinstall does not remove the newer registration", () => {
	const { Own } = makeClasses();
	const first = installPrototypePatch(Own.prototype, "render", "tool-execution-render", () => "first");
	const second = installPrototypePatch(Own.prototype, "render", "tool-execution-render", () => "second");
	first();
	assert.equal(new Own().render(), "second");
	second();
	assert.equal(new Own().render(), "own");
});

test("selector border patches leave no own render on Pi selector prototypes after cleanup", () => {
	assert.ok(!has(ModelSelectorComponent.prototype, "render"));
	assert.ok(!has(SettingsSelectorComponent.prototype, "render"));
	const cleanup = installSelectorBorderStyle();
	assert.ok(has(ModelSelectorComponent.prototype, "render"));
	cleanup();
	assert.ok(!has(ModelSelectorComponent.prototype, "render"));
	assert.ok(!has(SettingsSelectorComponent.prototype, "render"));
	assert.equal(ModelSelectorComponent.prototype.render, Container.prototype.render);
});
