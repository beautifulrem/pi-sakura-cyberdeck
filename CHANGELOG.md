# Changelog

All notable changes to pi-sakura-cyberdeck. After updating, Pi shows the newest
entry once above the editor; run `/sakura-changelog` to read this file inside Pi.

## [1.2.0] - 2026-09-30

### Highlights

- PLACEHOLDER

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
