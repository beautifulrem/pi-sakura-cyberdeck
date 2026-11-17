import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { parseChangelog, renderChangelogLines } from "../extensions/changelog/index";

const plain = { fg: (_c: string, t: string) => t, bold: (t: string) => t } as never;

const SAMPLE = `# Changelog

## [1.2.0] - 2026-09-30

### Highlights

- **Lighter**: removed the fixed editor.
- Faster idle footer.

### Fixed

- Bug one with a very long description that has to wrap across several lines in a narrow terminal window.
  - nested detail

## [1.1.6] - 2026-09-30

- Removed quota UI.

## 1.0.0

- Initial.
`;

test("parseChangelog reads versions, dates, sections and bullets", () => {
	const entries = parseChangelog(SAMPLE);
	assert.deepEqual(entries.map((e) => e.version), ["1.2.0", "1.1.6", "1.0.0"]);
	assert.equal(entries[0]!.date, "2026-09-30");
	assert.deepEqual(entries[0]!.sections.map((s) => s.title), ["Highlights", "Fixed"]);
	assert.equal(entries[1]!.sections[0]!.lines.length, 1);
});

test("full changelog wraps long bullets within width", () => {
	const lines = renderChangelogLines(parseChangelog(SAMPLE), 40, plain);
	assert.ok(lines.every((l) => visibleWidth(l) <= 40));
	assert.ok(lines.filter((l) => l.trim()).length > 8);
});

test("shipped CHANGELOG.md has an entry for the package version", () => {
	const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	const entries = parseChangelog(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
	assert.equal(entries[0]?.version, pkg.version);
	assert.ok(entries[0]!.sections.some((s) => /highlight/i.test(s.title)));
});
