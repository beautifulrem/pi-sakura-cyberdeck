import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { readRuntimeInfo } from "../extensions/zentui/runtime";

test(
	"a failed runtime version probe is retried later instead of cached for the process",
	{ skip: process.platform === "win32" ? "uses a POSIX shell shim on PATH" : false },
	async (t) => {
		const root = mkdtempSync(join(tmpdir(), "zentui-runtime-"));
		const bin = join(root, "bin");
		const project = join(root, "project");
		const flag = join(root, "warm");
		const calls = join(root, "calls");
		for (const dir of [bin, project]) mkdirSync(dir, { recursive: true });
		writeFileSync(join(project, "go.mod"), "module example.com/x\n");
		// A cold version-manager shim: fails until it has been "warmed up".
		writeFileSync(
			join(bin, "go"),
			`#!/bin/sh\necho x >> "${calls}"\n[ -f "${flag}" ] || exit 1\necho "go version go1.99.0 test/arch"\n`,
		);
		chmodSync(join(bin, "go"), 0o755);
		const originalPath = process.env.PATH;
		process.env.PATH = `${bin}${delimiter}${originalPath ?? ""}`;
		t.after(() => {
			process.env.PATH = originalPath;
		});
		t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
		const spawns = () => (existsSync(calls) ? readFileSync(calls, "utf8").split("\n").length - 1 : 0);
		const version = async () => {
			const result = await readRuntimeInfo(project);
			assert.equal(result.kind, "ok");
			return result.kind === "ok" ? result.runtime?.version : undefined;
		};

		assert.equal(await version(), undefined);
		assert.equal(spawns(), 1);
		// Within the retry window the failure is reused: no spawn per refresh.
		writeFileSync(flag, "");
		assert.equal(await version(), undefined);
		assert.equal(spawns(), 1);

		t.mock.timers.tick(60_000);
		assert.equal(await version(), "v1.99.0");
		assert.equal(spawns(), 2);

		// A successful read stays cached until the project state changes.
		t.mock.timers.tick(60 * 60_000);
		assert.equal(await version(), "v1.99.0");
		assert.equal(spawns(), 2);
	},
);

