// Package-level sanity checks (manifest, shipped files, theme, changelog).
// Behavior is covered by the unit tests in test/ (`npm test`).
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const exists = (path) => access(resolve(root, path)).then(() => true, () => false);
const manifest = JSON.parse(await read("package.json"));

assert.equal(manifest.name, "pi-sakura-cyberdeck");
assert.ok(manifest.keywords.includes("pi-package"));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);

// Host packages are provided by Pi: peer "*" only, never bundled.
const HOST = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "typebox"];
for (const name of Object.keys(manifest.dependencies ?? {})) {
	assert.ok(!HOST.includes(name), `host package ${name} must not be a dependency`);
}
assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [], "the pack ships without runtime dependencies");
assert.equal(manifest.devDependencies, undefined, "dev tooling lives in .dev/ (npm run dev:setup)");

// The suite must run on Node with type stripping only (Node 26 removed
// --experimental-transform-types), so no TS runtime-only syntax is allowed.
assert.ok(
	!manifest.scripts.test.includes("experimental-transform-types"),
	"test script must not rely on the removed --experimental-transform-types flag",
);
function assertNoParameterProperties(file, source) {
	for (const match of source.matchAll(/\bconstructor\s*\(/g)) {
		let depth = 1;
		let index = match.index + match[0].length;
		const start = index;
		while (index < source.length && depth > 0) {
			const ch = source[index];
			if (ch === "(") depth += 1;
			else if (ch === ")") depth -= 1;
			index += 1;
		}
		const params = source.slice(start, index - 1);
		assert.ok(
			!/^\s*(private|public|protected|readonly)\s/m.test(params),
			`${file}: constructor parameter properties break Node type stripping`,
		);
	}
}

// Every declared resource exists; removed components stay removed.
for (const path of [...manifest.pi.extensions, ...manifest.pi.themes]) assert.ok(await exists(path), `missing ${path}`);
assert.equal(manifest.pi.extensions.some((path) => path.includes("dual-quota")), false);
assert.equal(await exists("extensions/dual-quota"), false);
assert.equal(await exists("extensions/zentui/fixed-editor"), false, "fixed editor was removed in 1.2.0");

// Every imported host package is declared as a peer.
async function listTs(dir) {
	const out = [];
	for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) out.push(...(await listTs(rel)));
		else if (entry.name.endsWith(".ts")) out.push(rel);
	}
	return out;
}
for (const file of await listTs("extensions")) {
	const source = await read(file);
	assertNoParameterProperties(file, source);
	for (const [, spec] of source.matchAll(/from\s+"([^".][^"]*)"/g)) {
		if (spec.startsWith("node:")) continue;
		assert.ok(spec in (manifest.peerDependencies ?? {}), `${file} imports undeclared package ${spec}`);
	}
}
for (const file of await listTs("test")) {
	assertNoParameterProperties(file, await read(file));
}

// Shipped files: runtime resources + docs only.
for (const entry of ["extensions", "themes", "licenses", "README.md", "CHANGELOG.md", "LICENSE", "NOTICE"]) {
	assert.ok(manifest.files.includes(entry), `files must include ${entry}`);
}
for (const devOnly of ["scripts", "test", ".dev", "tsconfig.json"]) {
	assert.ok(!manifest.files.includes(devOnly), `files must not ship ${devOnly}`);
}

// Theme: every required Pi color is present.
const theme = JSON.parse(await read("themes/sakura-macaron.json"));
const requiredColors = [
	"accent", "border", "borderAccent", "borderMuted", "success", "error", "warning",
	"muted", "dim", "text", "thinkingText", "selectedBg", "userMessageBg",
	"userMessageText", "customMessageBg", "customMessageText", "customMessageLabel",
	"toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput", "mdHeading",
	"mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote",
	"mdQuoteBorder", "mdHr", "mdListBullet", "toolDiffAdded", "toolDiffRemoved",
	"toolDiffContext", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
	"syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
	"thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh",
	"thinkingXhigh", "thinkingMax", "bashMode",
];
assert.equal(theme.name, "sakura-macaron");
for (const color of requiredColors) assert.ok(color in theme.colors, `missing theme color: ${color}`);

// Changelog and README document the current version (the update notice reads CHANGELOG.md).
const changelog = await read("CHANGELOG.md");
const firstEntry = changelog.match(/^##\s+\[?v?(\d+\.\d+\.\d+)\]?/m)?.[1];
assert.equal(firstEntry, manifest.version, "CHANGELOG.md must start with the package version");
const readme = await read("README.md");
assert.ok(readme.includes(`**v${manifest.version}**`), "README headline must mention the version");
assert.ok(readme.includes(`### ${manifest.version}`), "README changelog must list the version");

console.log(`pi-sakura-cyberdeck ${manifest.version} package check passed`);
