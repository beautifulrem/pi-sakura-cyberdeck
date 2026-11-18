import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as flush } from "node:timers/promises";
import { createProjectRefreshScheduler } from "../extensions/zentui/project-refresh";

function harness() {
	const started: string[] = [];
	const finish: Array<() => void> = [];
	const scheduler = createProjectRefreshScheduler<string>(
		(target) => {
			started.push(target);
			return new Promise<void>((resolve) => finish.push(resolve));
		},
		() => {},
		60_000,
	);
	return { scheduler, started, finish };
}

test("a forced refresh requested mid-flight runs as soon as the in-flight one ends", async (t) => {
	const { scheduler, started, finish } = harness();
	t.after(() => scheduler.stop());
	scheduler.schedule("a", { force: true });
	assert.deepEqual(started, ["a"]);
	scheduler.schedule("b", { force: true });
	// A later unforced request must not downgrade the pending force.
	scheduler.schedule("c");
	assert.deepEqual(started, ["a"]);
	finish[0]?.();
	await flush();
	assert.deepEqual(started, ["a", "c"]);
});

test("an unforced refresh requested mid-flight stays throttled", async (t) => {
	const { scheduler, started, finish } = harness();
	t.after(() => scheduler.stop());
	scheduler.schedule("a", { force: true });
	scheduler.schedule("b");
	finish[0]?.();
	await flush();
	assert.deepEqual(started, ["a"]);
});

test("stop() drops a pending forced refresh", async (t) => {
	const { scheduler, started, finish } = harness();
	t.after(() => scheduler.stop());
	scheduler.schedule("a", { force: true });
	scheduler.schedule("b", { force: true });
	scheduler.stop();
	scheduler.schedule("c");
	assert.deepEqual(started, ["a", "c"]);
	finish[1]?.();
	await flush();
	// The new cycle's pending state starts clean: an unforced request waits.
	scheduler.schedule("d");
	finish[0]?.();
	await flush();
	assert.deepEqual(started, ["a", "c"]);
});
