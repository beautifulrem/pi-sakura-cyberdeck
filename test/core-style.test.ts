import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isSupportedColorSpec } from "../extensions/zentui/style";

// Same host resolution as test/resolve-hooks.mjs: PI_HOST_ROOT overrides the .dev install.
const hostRoot = process.env.PI_HOST_ROOT
	? pathToFileURL(`${process.env.PI_HOST_ROOT.replace(/\/$/, "")}/`)
	: new URL("../.dev/node_modules/@earendil-works/pi-coding-agent/", import.meta.url);

type TokenInfo = { slot?: string };

/** Foreground theme tokens the host accepts: its token table, else its theme JSON schema. */
async function hostForegroundTokens(): Promise<string[] | undefined> {
	const tokensFile = new URL("dist/modes/interactive/theme/theme-tokens.js", hostRoot);
	if (existsSync(fileURLToPath(tokensFile))) {
		const { THEME_TOKENS } = (await import(tokensFile.href)) as { THEME_TOKENS: Record<string, TokenInfo> };
		return Object.entries(THEME_TOKENS)
			.filter(([, info]) => info.slot === "foreground")
			.map(([name]) => name);
	}
	for (const path of ["schemas/theme.schema.json", "dist/modes/interactive/theme/theme-schema.json"]) {
		const schemaFile = new URL(path, hostRoot);
		if (!existsSync(fileURLToPath(schemaFile))) continue;
		const schema = JSON.parse(readFileSync(schemaFile, "utf8"));
		// Older schemas carry no slot; background tokens are the `*Bg` keys.
		return Object.keys(schema.properties.colors.properties).filter((name) => !name.endsWith("Bg"));
	}
	return undefined;
}

test("every host foreground theme token is a valid Zentui color", async (t) => {
	if (!existsSync(fileURLToPath(new URL("package.json", hostRoot)))) {
		t.skip("no Pi host installed");
		return;
	}
	const tokens = await hostForegroundTokens();
	assert.ok(tokens && tokens.length > 0, "installed host must expose its theme tokens");
	// Subset, not equality: the suite also runs against older hosts with fewer tokens.
	const rejected = tokens.filter((token) => !isSupportedColorSpec(token));
	assert.deepEqual(rejected, [], "add these to themeColorTokens in style.ts");
	assert.ok(isSupportedColorSpec("bold searchMatchText"));
});
