import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Extensions resolve their config paths at import time from Pi's agent dir. A test run
// started without PI_CODING_AGENT_DIR must still never read or write ~/.pi/agent.
test("test harness points Pi's agent dir away from the developer's home", () => {
	const home = mkdtempSync(join(tmpdir(), "sakura-home-"));
	try {
		const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
		delete env.PI_CODING_AGENT_DIR;
		const script = `const m = await import(${JSON.stringify(join(root, "extensions/matrix/index.ts"))}); console.log(m.CONFIG_PATH);`;
		const out = execFileSync(
			process.execPath,
			["--no-warnings", "--import", "./test/register.mjs", "--input-type=module", "-e", script],
			{ cwd: root, env, encoding: "utf8" },
		).trim();
		assert.ok(out.endsWith("sakura-cyberdeck-matrix.json"), out);
		assert.ok(!out.startsWith(home), `config path leaked into HOME: ${out}`);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
