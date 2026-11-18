// Test-only module hooks: map Pi host packages to the dev install in .dev/ and
// resolve extensionless relative imports (Pi loads extensions through jiti).
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Extensions resolve config paths from Pi's agent dir at import time, so an unset
// PI_CODING_AGENT_DIR would make tests read (and could make them write) the developer's
// real ~/.pi/agent. Point it at a throwaway dir before any test module loads. Test files
// run as child processes that inherit this env; only the creating process removes it.
if (!process.env.PI_CODING_AGENT_DIR) {
	const agentDir = mkdtempSync(join(tmpdir(), "sakura-test-agent-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
}

register("./resolve-hooks.mjs", import.meta.url);
