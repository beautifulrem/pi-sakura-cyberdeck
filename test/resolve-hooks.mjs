import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// PI_HOST_ROOT=/path/to/node_modules/@earendil-works/pi-coding-agent runs the suite against another Pi.
const piRoot = process.env.PI_HOST_ROOT
	? pathToFileURL(`${process.env.PI_HOST_ROOT.replace(/\/$/, "")}/`)
	: new URL("../.dev/node_modules/@earendil-works/pi-coding-agent/", import.meta.url);
const hosts = {
	"@earendil-works/pi-coding-agent": piRoot,
	"@earendil-works/pi-tui": new URL("node_modules/@earendil-works/pi-tui/", piRoot),
	"@earendil-works/pi-ai": new URL("node_modules/@earendil-works/pi-ai/", piRoot),
};

export async function resolve(specifier, context, nextResolve) {
	const host = hosts[specifier];
	if (host) {
		return nextResolve(specifier, { ...context, parentURL: new URL("package.json", host).href });
	}
	if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
		const base = new URL(specifier, context.parentURL);
		const path = fileURLToPath(base);
		if (!/\.[cm]?[jt]s$/.test(path)) {
			for (const candidate of [`${path}.ts`, `${path}/index.ts`]) {
				if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
			}
		}
	}
	return nextResolve(specifier, context);
}
