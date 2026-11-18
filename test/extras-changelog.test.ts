import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseChangelog } from "../extensions/changelog/index";

const shipped = () => parseChangelog(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"));

test("shipped CHANGELOG.md release dates never increase going down the file", () => {
	const dated = shipped().filter((entry) => entry.date);
	assert.ok(dated.length > 5);
	for (let i = 1; i < dated.length; i++) {
		const newer = dated[i - 1]!;
		const older = dated[i]!;
		assert.ok(older.date! <= newer.date!, `${older.version} (${older.date}) is dated after ${newer.version} (${newer.date})`);
	}
});
