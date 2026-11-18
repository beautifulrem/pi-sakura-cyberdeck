# Changelog

All notable changes to pi-sakura-cyberdeck. Pi >= 1.5.0 shows new package entries
once after updating; run `/sakura-changelog` on any supported Pi to read this file.

## [Unreleased]

### Fixed

- Tool cards whose results contain images are framed like every other card. Previously any image
  block skipped the frame, so `read` of a PNG looked different depending on whether the model accepts
  images (non-vision models never receive the image) and `agent_browser` screenshot results were
  never framed. Text rows are padded so the right rail lines up; Kitty and iTerm2 image rows only
  gain the left rail so nothing is drawn over the picture.
- Sent prompts keep Pi's OSC 133 prompt markers at the start of the line. The rail used to push them
  inward, so Pi no longer stripped them (stray shell-prompt marks in the terminal) and fullscreen
  previous/next-prompt navigation could not find prompts.
- The framed editor keeps Pi's `↑ N more` / `↓ N more` scroll labels inside its gradient rule.
- Footer:
  - A literal `|` separator no longer eats the neighbouring segment's colour or reset.
  - Routed (virtual) models show their context usage instead of `--`.
  - `$directory` pulses like `$cwd`.
  - When another extension replaces the footer, Zentui stops its timers and git/runtime probes and no
    longer removes the other footer on `statusline disable` or shutdown. Only session start and an
    explicit `/zentui statusline enable` install the Zentui footer again.
  - A failed or timed-out runtime version check is retried after 30 s instead of being cached for
    the whole process.
  - Outside a git repository a refresh runs one `git rev-parse` instead of up to four failing git
    processes; a forced refresh requested during another refresh no longer waits for the throttle;
    settings that cannot change the probes no longer force a rescan.
- Settings:
  - Turning the editor off in a fresh config no longer turns message styling off with it.
  - Saving one extension-status setting keeps the built-in placements of the others (e.g.
    `codex-goal` stays in the middle) unless the file sets `defaultPlacement`.
  - Toggling the Thought trail re-renders thinking blocks already on screen.
  - `/zentui` commands outside the TUI (RPC, print) start from the saved config, not defaults.
  - `scrollbarTrack`, `scrollbarThumb` and `searchMatchText` are accepted as colour tokens.
- `/sakura-changelog`: no blank page after widening the terminal; hard-wrapped bullets reflow with a
  hanging indent; inline code spans close correctly.
- Matrix rain: `on` during a running preview keeps the rain for the rest of the run; wide terminals
  rain across the full width.
- Shimmer: pressing Esc after the answer (during compaction or other post-run work) no longer shows a
  success notice.
- Edit-card diff counts are computed once per result instead of on every frame.
- 1.5.0's release date is corrected to 2026-11-17.

### Development

- The test harness points `PI_CODING_AGENT_DIR` at a temp directory, so tests never read or write
  the developer's `~/.pi/agent` config.
- `scripts/check.mjs` also catches side-effect, dynamic and single-quoted imports of undeclared
  packages.

## [1.5.1] - 2026-11-17

### Highlights

- **Sakura prompt borders restored**: submitted questions keep their gradient frame instead of
  changing to a dim solid border in the default theme color-source mode.
- **Continuous tool-title gradients**: the complete title row, including its leading rule, status
  symbols/words and diff counts, uses one Sakura gradient matching the local Pi agent's rendering.

### Fixed

- Sent user-message borders retain their Sakura gradient in both theme and terminal color-source
  modes. Version 1.5.0 incorrectly mapped the default `userMessages: "theme"` frame to `borderMuted`,
  turning the gradient into a dim solid color after submitting a prompt. The color source now affects
  the message rail only; native message content and semantic status rails are unchanged.
- Tool title rows no longer splice separately sampled border segments around solid theme-colored
  status words. That split both removed the text gradient and turned the leading rule sky blue.
  Running, complete, failed, diff-count and clipped titles now share one full-row gradient; status
  rails remain theme-aware and result output stays native.
- Added exact-ANSI title regressions across three color modes, four widths, all states and edit diff
  counts, including cached renders and theme changes.
- Added a regression using the shipped Sakura theme and Pi's real `UserMessageComponent`, covering
  both color sources, truecolor/256-color/NO_COLOR, multiple widths, caching and invalidation.

## [1.5.0] - 2026-11-17

Rendering robustness release built against Pi 1.5.2: shell command headers get a `❯` prompt, theme
syntax colors and an expandable long-command preview, while thought trails stop breaking at inline
code and editor extensions keep working inside the frame.

### Highlights

- **Shell headers**: `❯ cd pi-sakura-cyberdeck && npm run typecheck && npm test (timeout 120s)`, with
  the active theme's syntax colors and a five-row collapsed preview that expands to the full command.
- **Thought trails stay intact**: long inline code, URLs, backticks and math no longer strand the tree
  on the right edge; digest rows are literal, sanitized text.
- **Theme-aware status**: running/done/failed use the theme's semantic colors, and log wording never
  turns a successful tool into `FAILED`.
- **Editor-extension safety**: borderless editors keep every row, clicks map through the frame, and
  fullscreen autocomplete paging and drag-capture survive wrapping.
- **The changelog comes from Pi**: the pack no longer keeps its own “what’s new” notice or state file;
  Pi shows package changelog entries under “Extension Updates”. `/sakura-changelog` stays for reading
  the full file inside Pi.
- **Theme schema fixed**: `$schema` points at `https://pi.dev/schemas/theme.schema.json` (Pi 1.2.0
  moved it). Dark appearance is inferred, keeping the theme valid on Pi 0.87.1 too.
- **`edit` cards are framed again**: `renderShell: "self"` tools (`edit` in Pi 1.5) are no longer
  skipped, so edit diffs get the same sakura card as every other tool.
- **Status labels carry the state**: `✓ BASH · COMPLETE` / `◆ BASH · RUNNING` / `× BASH · FAILED`,
  plus `+N −M` for diff results.
- **`npm test` works on Node 26**: constructor parameter properties are gone, so the suite runs on
  native type stripping (Node >= 22.18); `scripts/check.mjs` now parses with Node's own strip-only
  mode, catching non-erasable syntax anywhere without executing source.

### Changed

- Bash call headers use `❯` and Pi's active shell syntax colors; PowerShell uses its own grammar and
  `PS>` prompt. Long commands wrap with a hanging indent, show five visual rows while collapsed,
  and expand fully with the user's configured keybinding. Uses `registerToolRenderer` when available;
  execution, timers, results, truncation warnings and full-output links stay native.
- Tool status labels/rails use the active theme's semantic colors, not fixed RGB. Arbitrary log text
  is not classified as tool failure; structured warnings and errors keep Pi's own rendering.
- Thought-trail rows are literal display text: inline Markdown is not reparsed after prewrapping.
- Tool card status labels now always carry the state, plus diff counts when the tool's result has a
  unified diff: `◆ BASH · RUNNING`, `✓ BASH · COMPLETE`, `× BASH · FAILED`, `✓ EDIT · +3 −2 · COMPLETE`.
  Previously the settled state showed only `✓ BASH` — no state word, no counts. Counts are read from
  Pi's own `result.details.diff`, never from the rendered body.
- `edit` (and any other `renderShell: "self"` tool) is framed like every other tool card; only image
  results and hidden cards stay stock. Previously the pack skipped self-rendered tools, so `edit`
  diffs had no card at all.
- Dropped the custom one-time “what’s new” notice and `sakura-cyberdeck-state.json` (Pi's own package
  changelog already covers it, including `collapseChangelog`); `/sakura-changelog` still opens the
  scrollable viewer.
- The footer pulse pauses while a blocking extension dialog is open (`ui_prompt_start` / `ui_prompt_end`).
- The legacy fixed-editor notice now acknowledges a user already on `"tuiMode": "fullscreen"`.
- Documented why the tool-card frame keeps its `ToolExecutionComponent` hook instead of
  `pi.registerToolRenderer()` (that API draws inside the row, not the frame around it).

### Fixed

- Thought-trail rails escaping to line ends when inline backticks spanned prewrapped rows; regression
  checks now use Pi's real Markdown renderer with code, links, math, CJK/emoji and multiple widths.
  Digest text is sanitized before measurement; terminal controls/bidi overrides cannot escape to the
  terminal. Very narrow widths fall back to native thinking; clipped headers no longer split ANSI.
- Borderless custom editors losing their first/last rows. Editor mouse events now map through the
  frame to body/autocomplete coordinates, and wrappers forward fullscreen autocomplete paging.
- `NO_COLOR` leaking theme colors from pack-owned chrome and colors in shell expansion key hints.
- User-message theme color-source settings not repainting cached cards.
- Unified-diff changes starting with `+++` or `---` mistaken for file headers inside hunks.
- Theme schema tests skipping installed Pi 1.5.2 after its schema moved; both current and legacy
  paths are checked. Removed the optional `appearance` key rejected by Pi 0.87.1's schema.
- Legacy migration notice asking users to enable fullscreen when Pi already defaults to it.
- Node strip-only syntax guard missing parameter properties after commas: now uses Node's own
  parser without executing source, also catching enums and other non-erasable syntax.
- Editor extensions loaded after Zentui (e.g. `pi-fff`) no longer drop the editor rails and model line
  (#4). Reconcile on Pi's public `resources_discover` event after all `session_start` handlers finish,
  and on later surface events; wrap the foreign editor to preserve input and autocomplete. No timed
  settle window or polling is needed.
- Type checking resolves both nested and hoisted Pi dev packages; the tool-renderer test accepts
  Pi 1.5's `unknown` arguments.
- Theme `$schema` still pointed at the pre-1.2.0 raw GitHub path.
- `npm test` passed the removed `--experimental-transform-types` flag.

### Developer

- `engines.node >= 22.18`; README notes Pi's `PI_TUI_WRITE_LOG` ANSI capture for TUI debugging.

## [1.3.0] - 2026-11-17

A focused visual release: a compact thinking view and sakura-tinted code blocks.

### Highlights

- **Thought trail** — visible thinking blocks collapse into a compact, sakura-gradient `✦ Thought trail` digest.
- **Sakura code blocks** — ``` fences use the accent pink, code text the soft lilac.

### Added

- **Thought trail**: visible thinking blocks are compressed into a compact `✦ Thought trail · N steps`
  digest with sakura-gradient rails (`├─ ◇` / `╰─ ◇` per paragraph, wrapped rows keep their `│` rail)
  via Pi's public markdown transformer — display-only, no prototype patches, the session and model
  context keep the full thinking text. On by default; toggle with `/zentui thinking-trail on|off`
  (setting `features.thinkingTrail`).
- Fenced code blocks read as sakura: the ``` fences use the accent pink (`mdCodeBlockBorder`)
  and body text the soft lilac (`mdCodeBlock`). Pi's own `markdown.codeBlockIndent` still sets the indent.

## [1.2.0] - 2026-09-30

A robustness, performance and "lighter footprint" release based on a full code review
against Pi 0.99.1. Extension code shrank from ~12,000 to ~8,700 lines, the pack no longer
redraws the terminal while idle, and it no longer rewrites tool or command output.
Supported Pi versions: 0.87.1 and newer (tested on 0.87.1 and 0.99.1).

### Highlights

- **Idle means idle**: the footer no longer redraws the screen 4×/second forever (0 bytes written while idle, was ~3.4 KB/s).
- **Your output stays yours**: tool results, `!cmd` output and thinking are shown exactly as Pi renders them — no more added ✓/× glyphs, lost indentation, 200-line caps or replaced lines.
- **Fixed** `/zentui fixed-editor disable` turning off (and saving) the main editor.
- **Fixed** the working HUD being stuck at `↓ 1 token` on Anthropic models, and "done in 0s" after multi-step runs.
- **Safer git**: no more `index.lock` collisions with the agent's own git commands; far fewer git processes.
- **Removed** the obsolete fixed-editor compositor (~1,950 lines); use Pi's native `"tuiMode": "fullscreen"`.
- **Matrix rain is now opt-in** (`/sakura-matrix on`) and no longer fights the shimmer.
- **256-color terminals and `NO_COLOR`** are now respected by every effect.
- **New**: this what's-new notice after updates, and `/sakura-changelog` to read the changelog inside Pi.

### Fixed — editor, footer and settings (Zentui)

- `/zentui fixed-editor disable|enable|toggle` was parsed as the *editor* switch and disabled the main editor, persisting it to config. Direct commands are now parsed strictly (`/zentui <target> <on|off|toggle>`); anything else shows usage. If this bug turned your editor off earlier, run `/zentui editor on` once.
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

### Fixed — tool cards, messages and thinking

- `!cmd` output: expanded output was capped at ~19 lines, the bottom border was drawn as a second "BASH · COMPLETE" header, output lines that looked like box edges or `───` rules were replaced by frames, and failed or cancelled commands were labelled `✓ COMPLETE`. `!cmd` output is now stock Pi.
- Tool card bodies were rewritten: syntax and word-diff highlighting was lost, lines starting with `ok`/`Successfully`/`error` got ✓/× glyphs (which were copied with the text), lines starting with `read`/`edit`/`snake_case` words lost their indentation, long lines lost a trailing `...`, expanded output was capped at 200 lines, and collapsed bodies could be replaced by summaries. Bodies are now passed through byte-for-byte inside the sakura frame.
- Diff lines lost their indentation around line-number width changes (e.g. lines 95–105).
- Tool card status (running / done / failed) was guessed from the text; it now comes from the tool's real state.
- Clicking a tool card to expand it in fullscreen mode hit the wrong row.
- Clicking a thinking block to show/hide it stopped working in fullscreen mode, per-message thinking toggles were ignored, and visible thinking was cut to 16 lines. Thinking is now stock Pi; hidden thinking shows a sakura `✦ Thought` label.
- User messages lost ordered-list numbering (`1)`), backslash escapes and other extensions' markdown transforms. They are now Pi's own rendering inside the rail.
- Prototype patches could leave stale copies behind after uninstall, could stack on reload, and clashed with the upstream `pi-zentui` package's registry.

### Fixed — working HUD (shimmer)

- The live token counter stayed at `↓ 1 token` on Anthropic models while streaming (the provider's early placeholder count was treated as final).
- After an aborted or failed message the count dropped from thousands back to 1.
- The completion notice measured only the last turn ("Sparkled for 0s" after a run with tool calls); it now covers the whole run.
- The completion notice used an invalid notification type, and also appeared after Esc or errors. It now shows only after successful runs, once Pi has fully settled (after retries/compaction).
- The spinner verb changed after every tool call; it now stays the same for the whole run.
- The "stalled" coral fade and the tool-use pulse were never actually shown; both now work.
- The highlight popped in at the left edge instead of sweeping in smoothly; the first thinking frame could glow at a random phase.
- ©, ® and ™ were counted as two tokens each in the live estimate.
- In RPC mode every prompt sent clients a notification full of raw terminal escapes; print/json modes ran animation timers for nothing. Effects now run only in the interactive TUI.

### Fixed — matrix, header, theme

- Matrix listened to `session_switch`, an event Pi removed in 0.65.
- Matrix and shimmer both drove Pi's working indicator; switching matrix off mid-run reset the shimmer to Pi's default spinner.
- `/sakura-matrix preview` claimed "5 seconds" but did nothing while disabled or outside the TUI, and stopped the rain for the rest of a running turn.
- A failed matrix settings write left the in-memory state changed without stopping the rain or telling you.
- The header's top padding grew with terminal height (19 blank lines at 50 rows) and changed on every vertical resize; it is now a fixed single line.
- Theme `dim` text failed WCAG AA contrast (3.5:1 → 4.7:1); muted borders are more visible.

### Performance

- No redraws while idle (footer pulse is now opt-in and only runs while the agent works).
- Context-usage and usage-total calculations are cached like Pi's own footer instead of rescanning the session on every frame.
- Working HUD: one ~11 Hz clock instead of three (≈40–55 renders/s → ≤11).
- Git: one `status --porcelain=2 --branch --show-stash` plus one `rev-parse` per refresh instead of ~10 processes; nothing runs when git segments are hidden.
- Runtime/package probes run only when their segments are visible, once per change, never in non-interactive modes.
- Tool cards are cached with no size limit and do no per-line regex work; the gradient cache no longer thrashes on animation frames.
- The clock segment wakes once a minute instead of every second.

### Security and robustness

- A malicious repository could inject terminal escape sequences (e.g. clipboard writes) through `package.json` version, folder names, branch/tag names or runtime output shown in the footer. All external text is now sanitised.
- Git runs with `GIT_OPTIONAL_LOCKS=0` and `-c core.fsmonitor=false`, and project probes (git, runtime, package) are skipped in untrusted projects.
- Config and state writes (Zentui, matrix, changelog) are atomic; broken config files are reported instead of silently replaced.
- Matrix settings now live in Pi's agent directory (respects `PI_CODING_AGENT_DIR`) like the other pack files.
- All UI work is guarded for disposed UIs and non-TUI modes; shutdown cleanup is idempotent; nothing prints with `console.*` while the TUI runs.

### Changed

- **Sakura Matrix is off by default** and is now a rain widget only (it no longer changes the working message or indicator). Turn it on with `/sakura-matrix on`; saved settings are kept.
- New `/sakura-matrix` subcommands: `help`, `height N`; clearer validation and "not saved" messages.
- The footer pulse animation is opt-in: `/zentui pulse on` (setting `animations.footerPulse`).
- New switch `features.messageStyle` (`/zentui messages on|off`) controls message and tool styling independently of the editor. Existing configs keep their previous look: if you had the editor turned off, message styling stays off until you enable it.
- Tool cards keep the sakura frame and status rail, but edit/self-rendered tools and image results use Pi's stock rendering.
- The "Thought trail" tree is gone; hidden thinking shows a `✦ Thought` label.
- Header height is fixed; the header is only installed in the interactive TUI.
- Runtime segment detects bun, deno, node, python, go, rust, ruby and java (~50 rarely used runtimes removed). Package version reads `package.json`, `Cargo.toml`, `pyproject.toml` and `composer.json`.
- Default background project refresh is every 60 s (and only when something visible needs it).
- Colors follow Pi's detected color mode: 24-bit on truecolor terminals, nearest 256-color otherwise, none with `NO_COLOR`.
- Theme adds scrollbar and search-match colors for Pi's fullscreen mode.

### Removed

- The experimental fixed-editor compositor (`fixedEditor` settings and `/zentui fixed-editor`). It was already disabled on Pi 0.84+; use Pi's `"tuiMode": "fullscreen"`. Old `fixedEditor` settings are removed from your config automatically (with a one-time notice if it was enabled).
- The `!cmd` output restyling and the tool-body rewriting described above.
- Unused code paths and exports (dual-quota leftovers, dead helpers).

### Added

- A one-time "what's new" notice above the editor after installing or updating (hidden after your next message).
- `/sakura-changelog [version]` — scrollable changelog viewer inside Pi.
- `CHANGELOG.md` shipped with the package.

### Developer

- Real unit tests (`npm test`, 100+ tests) and a strict type check (`npm run typecheck`) against Pi 0.99.1; the suite also passes against Pi 0.87.1 (`PI_HOST_ROOT=…`). Set up with `npm run dev:setup` (installs into `.dev/`, nothing is added to the package).
- `scripts/check.mjs` now validates the manifest, shipped files, peer dependencies, theme keys and changelog instead of regex-matching source code.
- The published package no longer ships `scripts/`.

## [1.1.6] - 2026-09-30

- Remove the Codex/Grok subscription quota component, including footer chips, API polling, caching, and the `/dual-usage` command.

## [1.1.5] - 2026-08-08

- **Pi 0.84+**: disable fixed-editor by default and hard-block the compositor on native sticky/fullscreen TUI layouts (prevents broken input after upgrading Pi).
- Document using Pi `tuiMode: "fullscreen"` for sticky editor instead of the experimental fixed-editor compositor.

## [1.1.4] - 2026-07-26

- **Thinking HUD**: remove the brief pink per-thought timer; the muted total turn timer remains.
- **Fixed editor**: cluster mouse clicks now pass through to below-editor widgets while transcript selection stays owned by the compositor.

## [1.1.3] - 2026-07-26

- **Token HUD**: provider-reported `usage.output` is authoritative and accumulated across tool turns.
- Live stream fallback handles CJK/emoji better than raw `chars / 4`; `~` marks estimated values.
- Labels are readable and compact: `144 tokens`, `1.2k tokens`, `12.3k tokens`, `1.2M tokens`.
- Final usage can correct a live estimate downward instead of leaving an inflated count.

## [1.1.2] - 2026-07-26

- **Fixed editor**: output completion no longer leaves a blank gap hiding transcript text until scroll.
- Cluster paint now clears only rows it still owns; a focused regression check covers the shrink case.

## [1.1.1] - 2026-07-26

- **Tool cards**: stop right-edge `...` on every body line.
- **Diff body**: Pi-native `±12 text` without extra `│` gutters eating width.
- **Context gauge**: solid butter (warning) / coral (error) at high %.
- **Tool left rail**: sky / mint / coral status cues.
- **Self-shell tools** (edit): also polished and framed.
- **Startup**: deferred project refresh and other startup work.

## [1.1.0] - 2026-07-26

- Macaron truecolor footer: gradient separators, pulsed context gauge, sky context text and peach cost.
- Thought trail: sakura chrome, tight vertical spacing.
- Tool cards: symmetric frame gradient, path/title color consistency.
- Bundled sakura Claude shimmer (effort HUD and verb list).

## [1.0.0] - 2026-07-22

- Initial theme, header, matrix and Zentui pack.
