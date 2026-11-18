import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseChangelog, renderChangelogLines } from "../extensions/changelog/index";

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

const plain = { fg: (_c: string, t: string) => t, bold: (t: string) => t } as never;

const WRAPPED = `## [2.0.0] - 2026-12-01

An intro paragraph that is
hard-wrapped in the source.

Second paragraph.

### Fixed

- **Wrapped bullet**: the first source line of a long bullet that
  continues on the next source line with \`code that
  spans\` two lines and **bold that
  spans** too.
  - nested detail that is
    also hard-wrapped
- Next bullet.
`;

test("hard-wrapped bullets and paragraphs reflow to the width with a hanging indent", () => {
	const wide = renderChangelogLines(parseChangelog(WRAPPED), 200, plain);
	assert.deepEqual(wide.slice(1), [
		"    An intro paragraph that is hard-wrapped in the source.",
		"    Second paragraph.",
		"  Fixed",
		"    • Wrapped bullet: the first source line of a long bullet that continues on the next source line with code that spans two lines and bold that spans too.",
		"      ◦ nested detail that is also hard-wrapped",
		"    • Next bullet.",
	]);
	const narrow = renderChangelogLines(parseChangelog(WRAPPED), 40, plain);
	const bullet = narrow.slice(narrow.findIndex((l) => l.includes("• Wrapped")), narrow.findIndex((l) => l.includes("◦")));
	assert.ok(bullet.length > 2);
	for (const row of bullet.slice(1)) assert.match(row, /^ {6}\S/, `continuation keeps the hanging indent: ${JSON.stringify(row)}`);
});

test("inline code needs a closing run of the same length; literal ``` survives", () => {
	const entry = shipped().find((e) => e.version === "1.3.0")!;
	const text = renderChangelogLines([entry], 300, plain).join("\n");
	assert.match(text, /the ``` fences use the accent pink \(mdCodeBlockBorder\) and body text the soft lilac \(mdCodeBlock\)\./);
});
