# pi-sakura-cyberdeck

Lightweight Sakura Macaron visual pack for [Pi](https://pi.dev).

**v1.2.0** — robustness, performance and footprint release: no idle redraws, no rewriting of tool or command output, safer git, fixed-editor removed, matrix opt-in, 256-color/`NO_COLOR` support, and an in-app changelog. See [what changed](#120).

## What’s inside

| Piece | Role |
|-------|------|
| **Theme** `sakura-macaron` | Dark macaron palette (sakura / peach / petal / lavender / sky / mint / coral), incl. fullscreen scrollbar and search colors |
| **Header** | Sakura→sky cyberdeck startup art |
| **Zentui** | Editor rails, Starship-style footer, sakura tool/message frames |
| **Claude shimmer** | Working line with macaron sweep, effort + token HUD |
| **Matrix** | Pastel digital-rain widget while working — **off by default**, `/sakura-matrix on` |
| **Changelog** | One-time “what’s new” notice after updates, `/sakura-changelog` viewer |

No runtime dependencies; everything uses Pi’s public extension API except three small, guarded render patches (user messages, tool card frames, selector borders).

## Look (v1.2)

**Footer**

```text
󰀵  project  on 󰘬 main   [███░░░░░░░] 4%/128k › ↑12k ↓1.4k › $0.06
```

- Context gauge: macaron gauge; context label **sky**, cost **peach**
- Separators / cwd / os: sakura gradient accents
- Totals match Pi’s own footer (incl. compaction and subagent/tool usage)
- Static by default; `/zentui pulse on` animates it while the agent works

**Working line**

```text
✻ Whisking...  ( HIGH · ↓ ~1.2k tokens · 00:12 )
```

- Effort MINIMAL→MAX, tier-colored; one verb per run
- Tokens: `~` marks the live estimate; the provider’s final count replaces it and accumulates across tool turns
- Fades toward coral when the stream stalls; pulses mint while a tool runs
- `✻ Whisked for 12s` after a successful run (whole-run time)

**History**

```text
╭─ ✓ READ ─────────────────────────╮
┃  read src/app.ts                 │
┃  …Pi’s own output, unchanged…    │
╰──────────────────────────────────╯
```

- Tool cards: sakura frame + status rail (sky running / mint done / coral failed); the body is Pi’s own render, byte-for-byte
- `!cmd` output, edit diffs and images: stock Pi
- Hidden thinking shows a sakura `✦ Thought` label; visible thinking is stock Pi

## Requirements

- Pi **>= 0.87.1** (tested on 0.87.1 and 0.99.1)
- Dark terminal background (the theme does not paint a background)
- Truecolor recommended; 256-color terminals get the nearest palette colors, `NO_COLOR` disables the pack’s own colors
- Nerd Font for the default icons (`icons.mode: "ascii"` works without)

## Install

```bash
pi install git:github.com/beautifulrem/pi-sakura-cyberdeck
```

Local:

```bash
pi install /path/to/pi-sakura-cyberdeck
```

Then `/settings` → theme **sakura-macaron** (Pi 0.99 defaults to its `system` theme). Restart Pi once.

> Prefer **this package’s shimmer** over stock `npm:pi-claude-shimmer`.

### Updating

For an unpinned Git installation:

```bash
pi update git:github.com/beautifulrem/pi-sakura-cyberdeck
```

Restart Pi after updating. The first session after an update shows **what’s new** above the editor (it disappears after your next message); run `/sakura-changelog` any time to read the full changelog inside Pi, or see [CHANGELOG.md](CHANGELOG.md).

Pi does not push package updates automatically. Users who pinned a tag or commit must explicitly select the new version:

```bash
pi install git:github.com/beautifulrem/pi-sakura-cyberdeck@v1.2.0
```

Notes for 1.2.0:

- Existing theme and Zentui settings are preserved.
- The fixed-editor compositor was removed. Old `fixedEditor` settings are cleaned up automatically with a one-time notice; use Pi’s fullscreen mode below instead.
- Sakura Matrix is now off by default. If you had explicitly saved it on, it stays on; otherwise run `/sakura-matrix on`.
- The footer pulse animation is now opt-in (`/zentui pulse on`).

### Sticky editor (Pi fullscreen mode)

For a sticky editor and scrollable transcript use Pi’s native fullscreen TUI:

```jsonc
// ~/.pi/agent/settings.json
{
  "tuiMode": "fullscreen"
}
```

Or start with `pi --tui-mode fullscreen`. Pack styling (editor chrome, footer, shimmer, theme scrollbar/search colors) still applies.

## Configuration

Zentui config file: `~/.pi/agent/sakura-cyberdeck-zentui.json` (edit with `/zentui`). If the file contains invalid JSON, the pack warns you at startup and does not overwrite it.

```jsonc
// ~/.pi/agent/sakura-cyberdeck-zentui.json (excerpt)
{
  "colors": {
    "contextNormal": "syntaxFunction",
    "cost": "mdCode",
    "editorBorder": "sakura-macaron-gradient"
  },
  "features": {
    "messageStyle": true      // sakura frames for messages and tool cards
  },
  "animations": {
    "footerPulse": false      // animate footer gradients while the agent works
  }
}
```

Matrix settings live in `~/.pi/agent/sakura-cyberdeck-matrix.json` (edit with `/sakura-matrix`).

## Commands

```text
/zentui                                   settings UI (editor, footer, messages, icons, colors…)
/zentui editor|statusline|messages|copy-friendly|pulse on|off|toggle
/zentui format "<template>"               custom footer format ("" = segment layout)

/sakura-matrix [status]                   current rain settings
/sakura-matrix on|off                     enable / disable the rain widget
/sakura-matrix preview                    show the rain for 5 seconds
/sakura-matrix fps N | density N | height N
/sakura-matrix help

/sakura-changelog [version]               scrollable changelog (q / Esc to close)
```

## Conflicts

Avoid stacking with `pi-zentui`, `pi-powerline-footer`, stock `pi-claude-shimmer`, or a second copy of this pack. They share the footer / working line / editor surfaces.

## Changelog

Full history: [CHANGELOG.md](CHANGELOG.md) (also available in Pi via `/sakura-changelog`).

### 1.2.0

A robustness, performance and "lighter footprint" release based on a full code review
against Pi 0.99.1. Extension code shrank from ~12,000 to ~8,700 lines, the pack no longer
redraws the terminal while idle, and it no longer rewrites tool or command output.
Supported Pi versions: 0.87.1 and newer (tested on 0.87.1 and 0.99.1).

#### Highlights

- **Idle means idle**: the footer no longer redraws the screen 4×/second forever (0 bytes written while idle, was ~3.4 KB/s).
- **Your output stays yours**: tool results, `!cmd` output and thinking are shown exactly as Pi renders them — no more added ✓/× glyphs, lost indentation, 200-line caps or replaced lines.
- **Fixed** `/zentui fixed-editor disable` turning off (and saving) the main editor.
- **Fixed** the working HUD being stuck at `↓ 1 token` on Anthropic models, and "done in 0s" after multi-step runs.
- **Safer git**: no more `index.lock` collisions with the agent's own git commands; far fewer git processes.
- **Removed** the obsolete fixed-editor compositor (~1,950 lines); use Pi's native `"tuiMode": "fullscreen"`.
- **Matrix rain is now opt-in** (`/sakura-matrix on`) and no longer fights the shimmer.
- **256-color terminals and `NO_COLOR`** are now respected by every effect.
- **New**: this what's-new notice after updates, and `/sakura-changelog` to read the changelog inside Pi.

#### Fixed — editor, footer and settings (Zentui)

- `/zentui fixed-editor disable|enable|toggle` was parsed as the *editor* switch and disabled the main editor, persisting it to config. Direct commands are now parsed strictly (`/zentui <target> <on|off|toggle>`); anything else shows usage.
- Lines you typed in the editor that contained both the model and provider name (e.g. "compare gpt-5 with OpenAI") were deleted from the editor view. Only lines Zentui itself renders are ever stripped now.
- Footer token and cost totals undercounted: compaction, branch-summary, `usage` entries and tool-result usage (subagents / codemode) were missing. Totals now match Pi's own footer.
- An extension status with a key such as `constructor` or `__proto__` crashed every footer render.
- Settings changes (enabling git commit/metrics, package version, footer format, icon mode) did not apply until the next refresh or restart; they now apply immediately.
- Built-in defaults disagreed with what users actually got (refresh interval, footer format, icons). Defaults now come from one place.
- A corrupt `sakura-cyberdeck-zentui.json` silently reset every setting to defaults. You now get a warning naming the file and the JSON error, and the file is never overwritten until fixed.
- `$sep` in a custom `footerFormat` always rendered ` | ` regardless of the separator setting.
- Numbers from 999,500 to 999,999 were shown as `1000k` (now `1.0M`).
- A `"bold accent"` style spec dropped the theme color.
- Gradients split emoji ZWJ sequences and combining marks (e.g. accented folder names) into broken pieces.
- The git segment silently froze with stale data when `git status` output exceeded 1 MB (very large change sets); the buffer is now 16 MB and failures show `[git n/a]`.
- Non-English git locales made normal folders look like git errors; git now runs with `LC_ALL=C`.
- Windows absolute paths were not recognised in git path handling.
- Runtime versions ignored the project folder and went stale after `nvm use` / `pyenv local`; they now run in the project folder and refresh when version files change.
- Thinking level `max` had no color of its own (new `colors.editorThinkingMax`).

#### Fixed — tool cards, messages and thinking

- `!cmd` output: expanded output was capped at ~19 lines, the bottom border was drawn as a second "BASH · COMPLETE" header, output lines that looked like box edges or `───` rules were replaced by frames, and failed or cancelled commands were labelled `✓ COMPLETE`. `!cmd` output is now stock Pi.
- Tool card bodies were rewritten: syntax and word-diff highlighting was lost, lines starting with `ok`/`Successfully`/`error` got ✓/× glyphs (which were copied with the text), lines starting with `read`/`edit`/`snake_case` words lost their indentation, long lines lost a trailing `...`, expanded output was capped at 200 lines, and collapsed bodies could be replaced by summaries. Bodies are now passed through byte-for-byte inside the sakura frame.
- Diff lines lost their indentation around line-number width changes (e.g. lines 95–105).
- Tool card status (running / done / failed) was guessed from the text; it now comes from the tool's real state.
- Clicking a tool card to expand it in fullscreen mode hit the wrong row.
- Clicking a thinking block to show/hide it stopped working in fullscreen mode, per-message thinking toggles were ignored, and visible thinking was cut to 16 lines. Thinking is now stock Pi; hidden thinking shows a sakura `✦ Thought` label.
- User messages lost ordered-list numbering (`1)`), backslash escapes and other extensions' markdown transforms. They are now Pi's own rendering inside the rail.
- Prototype patches could leave stale copies behind after uninstall, could stack on reload, and clashed with the upstream `pi-zentui` package's registry.

#### Fixed — working HUD (shimmer)

- The live token counter stayed at `↓ 1 token` on Anthropic models while streaming (the provider's early placeholder count was treated as final).
- After an aborted or failed message the count dropped from thousands back to 1.
- The completion notice measured only the last turn ("Sparkled for 0s" after a run with tool calls); it now covers the whole run.
- The completion notice used an invalid notification type, and also appeared after Esc or errors. It now shows only after successful runs, once Pi has fully settled (after retries/compaction).
- The spinner verb changed after every tool call; it now stays the same for the whole run.
- The "stalled" coral fade and the tool-use pulse were never actually shown; both now work.
- The highlight popped in at the left edge instead of sweeping in smoothly; the first thinking frame could glow at a random phase.
- ©, ® and ™ were counted as two tokens each in the live estimate.
- In RPC mode every prompt sent clients a notification full of raw terminal escapes; print/json modes ran animation timers for nothing. Effects now run only in the interactive TUI.

#### Fixed — matrix, header, theme

- Matrix listened to `session_switch`, an event Pi removed in 0.65.
- Matrix and shimmer both drove Pi's working indicator; switching matrix off mid-run reset the shimmer to Pi's default spinner.
- `/sakura-matrix preview` claimed "5 seconds" but did nothing while disabled or outside the TUI, and stopped the rain for the rest of a running turn.
- A failed matrix settings write left the in-memory state changed without stopping the rain or telling you.
- The header's top padding grew with terminal height (19 blank lines at 50 rows) and changed on every vertical resize; it is now a fixed single line.
- Theme `dim` text failed WCAG AA contrast (3.5:1 → 4.7:1); muted borders are more visible.

#### Performance

- No redraws while idle (footer pulse is now opt-in and only runs while the agent works).
- Context-usage and usage-total calculations are cached like Pi's own footer instead of rescanning the session on every frame.
- Working HUD: one ~11 Hz clock instead of three (≈40–55 renders/s → ≤11).
- Git: one `status --porcelain=2 --branch --show-stash` plus one `rev-parse` per refresh instead of ~10 processes; nothing runs when git segments are hidden.
- Runtime/package probes run only when their segments are visible, once per change, never in non-interactive modes.
- Tool cards are cached with no size limit and do no per-line regex work; the gradient cache no longer thrashes on animation frames.
- The clock segment wakes once a minute instead of every second.

#### Security and robustness

- A malicious repository could inject terminal escape sequences (e.g. clipboard writes) through `package.json` version, folder names, branch/tag names or runtime output shown in the footer. All external text is now sanitised.
- Git runs with `GIT_OPTIONAL_LOCKS=0` and `-c core.fsmonitor=false`, and project probes (git, runtime, package) are skipped in untrusted projects.
- Config writes are atomic; broken config files are reported instead of silently replaced.
- All UI work is guarded for disposed UIs and non-TUI modes; shutdown cleanup is idempotent; nothing prints with `console.*` while the TUI runs.

#### Changed

- **Sakura Matrix is off by default** and is now a rain widget only (it no longer changes the working message or indicator). Turn it on with `/sakura-matrix on`; saved settings are kept.
- New `/sakura-matrix` subcommands: `help`, `height N`; clearer validation and "not saved" messages.
- The footer pulse animation is opt-in: `/zentui pulse on` (setting `animations.footerPulse`).
- New switch `features.messageStyle` (`/zentui messages on|off`) controls message and tool styling independently of the editor.
- Tool cards keep the sakura frame and status rail, but edit/self-rendered tools and image results use Pi's stock rendering.
- The "Thought trail" tree is gone; hidden thinking shows a `✦ Thought` label.
- Header height is fixed; the header is only installed in the interactive TUI.
- Runtime segment detects bun, deno, node, python, go, rust, ruby and java (~50 rarely used runtimes removed). Package version reads `package.json`, `Cargo.toml`, `pyproject.toml` and `composer.json`.
- Default background project refresh is every 60 s (and only when something visible needs it).
- Colors follow Pi's detected color mode: 24-bit on truecolor terminals, nearest 256-color otherwise, none with `NO_COLOR`.
- Theme adds scrollbar and search-match colors for Pi's fullscreen mode.

#### Removed

- The experimental fixed-editor compositor (`fixedEditor` settings and `/zentui fixed-editor`). It was already disabled on Pi 0.84+; use Pi's `"tuiMode": "fullscreen"`. Old `fixedEditor` settings are cleaned up automatically with a one-time notice.
- The `!cmd` output restyling and the tool-body rewriting described above.
- Unused code paths and exports (dual-quota leftovers, dead helpers).

#### Added

- A one-time "what's new" notice above the editor after installing or updating (hidden after your next message).
- `/sakura-changelog [version]` — scrollable changelog viewer inside Pi.
- `CHANGELOG.md` shipped with the package.

#### Developer

- Real unit tests (`npm test`, 100+ tests) and a strict type check (`npm run typecheck`) against Pi 0.99.1; the suite also passes against Pi 0.87.1 (`PI_HOST_ROOT=…`). Set up with `npm run dev:setup` (installs into `.dev/`, nothing is added to the package).
- `scripts/check.mjs` now validates the manifest, shipped files, peer dependencies, theme keys and changelog instead of regex-matching source code.
- The published package no longer ships `scripts/`.

### 1.1.6

- Remove the Codex/Grok subscription quota component, including footer chips, API polling, caching, and the `/dual-usage` command.

### Earlier versions

See [CHANGELOG.md](CHANGELOG.md) for 1.0.0 – 1.1.5.

## Development

```bash
npm run dev:setup     # installs Pi + TypeScript into .dev/ (not shipped, no package deps)
npm run verify        # package check + strict typecheck + unit tests
PI_HOST_ROOT=/path/to/node_modules/@earendil-works/pi-coding-agent npm test   # test against another Pi
```

## License

MIT. Claude shimmer is a sakura-themed fork of [pi-claude-shimmer](https://github.com/ouzhenkun/pi-claude-shimmer) (MIT). Zentui is a modified copy of [pi-zentui](https://github.com/lmilojevicc/pi-zentui) (MIT, see NOTICE).
