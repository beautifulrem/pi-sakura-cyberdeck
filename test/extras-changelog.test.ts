import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import sakuraChangelog, { parseChangelog, renderChangelogLines } from "../extensions/changelog/index";

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

function openViewer(rows: { value: number }) {
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	sakuraChangelog({ registerCommand: (_name: string, options: { handler: typeof handler }) => void (handler = options.handler) } as never);
	let viewer: { render(width: number): string[]; handleInput(data: string): void } | undefined;
	const tui = { terminal: { get rows() { return rows.value; } }, requestRender: () => {} };
	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			notify: () => {},
			custom: async (factory: (...args: unknown[]) => typeof viewer) => void (viewer = factory(tui, plain, {}, () => {})),
		},
	};
	return handler!("", ctx).then(() => viewer!);
}

function footerRange(lines: string[]) {
	const match = /^ {2}(\d+)-(\d+)\/(\d+) /.exec(lines.at(-1)!);
	assert.ok(match, lines.at(-1));
	return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]), body: lines.slice(0, -2) };
}

test("viewer re-clamps the scroll offset when a wider width shortens the text", async () => {
	const viewer = await openViewer({ value: 30 });
	viewer.render(40);
	viewer.handleInput("G");
	const narrow = footerRange(viewer.render(40));
	assert.equal(narrow.end, narrow.total);
	const wide = footerRange(viewer.render(200));
	assert.ok(wide.total < narrow.total, "wider text has fewer rows");
	assert.ok(wide.start <= wide.end && wide.end === wide.total, `footer ${wide.start}-${wide.end}/${wide.total}`);
	assert.equal(wide.body.length, 22, "a full page stays visible");
});

test("viewer fills a taller page after the terminal grows", async () => {
	const rows = { value: 30 };
	const viewer = await openViewer(rows);
	viewer.render(100);
	viewer.handleInput("G");
	rows.value = 200;
	const tall = footerRange(viewer.render(100));
	assert.equal(tall.end, tall.total);
	assert.equal(tall.body.length, 40, "page size grew to 40 rows, all of them filled");
});
