// Installs dev-only tooling (Pi host packages for types/tests, TypeScript) into .dev/.
// Nothing here is shipped or required at runtime.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dev = resolve(root, ".dev");
const piVersion = process.env.PI_VERSION ?? "0.99.1";
mkdirSync(dev, { recursive: true });
if (!existsSync(resolve(dev, "package.json"))) writeFileSync(resolve(dev, "package.json"), '{"private":true}\n');
execFileSync(
	"npm",
	[
		"install", "--no-audit", "--no-fund",
		`@earendil-works/pi-coding-agent@${piVersion}`,
		`@earendil-works/pi-tui@${piVersion}`,
		"typescript@5", "@types/node@22",
	],
	{ cwd: dev, stdio: "inherit" },
);
