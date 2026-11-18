import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// scripts/check.mjs runs on import, so check a throwaway copy of the package that gains
// one extension file importing a package that is not a declared peer.
test("package check catches every form of undeclared package import", () => {
	const dir = mkdtempSync(join(tmpdir(), "sakura-check-"));
	try {
		cpSync(root, dir, { recursive: true, filter: (src) => !/[/\\](\.dev|\.git|node_modules)$/.test(src) });
		for (const source of [
			`import "left-pad";\n`,
			`import 'left-pad';\n`,
			`import pad from 'left-pad';\nexport default pad;\n`,
			`export const load = () => import("left-pad");\n`,
			`export * from "left-pad";\n`,
		]) {
			writeFileSync(join(dir, "extensions", "extras-probe.ts"), source);
			const run = spawnSync(process.execPath, ["--no-warnings", "scripts/check.mjs"], { cwd: dir, encoding: "utf8" });
			assert.notEqual(run.status, 0, `not caught: ${source}`);
			assert.match(run.stderr, /imports undeclared package left-pad/, source);
		}
		rmSync(join(dir, "extensions", "extras-probe.ts"));
		const clean = spawnSync(process.execPath, ["--no-warnings", "scripts/check.mjs"], { cwd: dir, encoding: "utf8" });
		assert.equal(clean.status, 0, clean.stderr);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
