import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultConfig, mergeConfig } from "../extensions/zentui/config";
import { footerWantsPulse } from "../extensions/zentui/footer";
import { planProjectProbes } from "../extensions/zentui/project-refresh";
import { detectRuntime } from "../extensions/zentui/runtime";
import { renderStyle } from "../extensions/zentui/style";

test("probes only run for visible segments", () => {
	const defaults = planProjectProbes(defaultConfig);
	assert.equal(defaults.git?.readStatus, true);
	assert.equal(defaults.git?.readState, true);
	assert.equal(defaults.git?.readMetrics, false);
	assert.equal(defaults.git?.readExactTag, false);
	assert.equal(defaults.runtime, true);
	assert.equal(defaults.packageVersion, false);
	assert.equal(defaults.clock, false);

	const off = planProjectProbes(
		mergeConfig({
			footerSegments: { gitBranch: false, gitStatus: false, runtime: false, time: true },
		}),
	);
	assert.equal(off.git, undefined);
	assert.equal(off.runtime, false);
	assert.equal(off.clock, true);

	// Branch name alone comes from Pi's footer data: only the cheap rev-parse for state.
	const branchOnly = planProjectProbes(mergeConfig({ footerSegments: { gitStatus: false } }));
	assert.deepEqual(
		{ status: branchOnly.git?.readStatus, state: branchOnly.git?.readState },
		{ status: false, state: true },
	);

	const format = planProjectProbes(mergeConfig({ footerFormat: "$cwd $git_tag$fill$package $time" }));
	// The tag is attached to the commit that `git status` reports, so status must run too.
	assert.equal(format.git?.readStatus, true);
	assert.equal(format.git?.readExactTag, true);
	assert.equal(format.runtime, false);
	assert.equal(format.packageVersion, true);
	assert.equal(format.clock, true);
});

test("footer pulse is opt-in and needs gradient content", () => {
	assert.equal(footerWantsPulse(defaultConfig), false);
	const on = mergeConfig({ animations: { footerPulse: true } });
	assert.equal(footerWantsPulse(on), true);
	assert.equal(footerWantsPulse(mergeConfig({ animations: { footerPulse: true }, icons: { mode: "ascii" } })), false);
	assert.equal(
		footerWantsPulse(mergeConfig({ animations: { footerPulse: true }, footerFormat: "$tokens $cost" })),
		false,
	);
});

test("runtime detection covers the common runtimes in priority order", () => {
	const detect = (...files: string[]) => detectRuntime((name) => files.includes(name))?.name;
	assert.equal(detect("package.json"), "nodejs");
	assert.equal(detect("package.json", "bun.lock"), "bun");
	assert.equal(detect("deno.json", "package.json"), "deno");
	assert.equal(detect("pyproject.toml"), "python");
	assert.equal(detect("go.mod"), "golang");
	assert.equal(detect("Cargo.toml"), "rust");
	assert.equal(detect("Gemfile"), "ruby");
	assert.equal(detect("pom.xml"), "java");
	assert.equal(detect("README.md"), undefined);
});

test("mixed style specs keep both the modifier and the theme color", () => {
	const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
	const out = renderStyle(theme, "bold accent", "x");
	assert.ok(out.includes("<accent>x</accent>"), out);
	assert.ok(out.startsWith("\x1b[1m"), out);
	assert.equal(renderStyle(theme, "accent", "x"), "<accent>x</accent>");
	assert.match(renderStyle(theme, "bold red", "x"), /^\x1b\[1;31mx\x1b\[0m$/);
});
