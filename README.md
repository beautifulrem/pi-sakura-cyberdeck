# pi-sakura-cyberdeck

Sakura Macaron visual pack for [Pi](https://pi.dev).

**v1.1.1** — tool-card ellipsis fix, tiered context gauge, macaron rails; builds on 1.1 chrome pack.

## What’s inside

| Piece | Role |
|-------|------|
| **Theme** `sakura-macaron` | Truecolor palette (sakura / peach / petal / lavender / sky / mint / coral) |
| **Header** | Sakura→sky cyberdeck startup art |
| **Matrix** | Pastel digital rain while working (optional; can conflict with shimmer) |
| **Zentui** | Editor, prompt rails, Starship footer, fixed bottom editor |
| **Dual-quota** | Codex + Grok remaining chips in the footer |
| **Claude shimmer** | Working spinner with macaron sweep + effort HUD |

## Look (v1.1)

**Footer**

```text
󰀵  project  on 󰘬 main   Codex ▕░·····▏  0% · in 1d · Grok ▕██····▏ 36% · in 5d   [███░░░░░░░] 4%/2m  $0.06
```

- Context bar: truecolor macaron gauge; label **sky** (not mint green)
- Cost: **peach**
- Separators / cwd / os: soft sakura gradient accents
- Dual-quota: identity tints + `· in Nd` reset text

**Working line**

```text
Whisking...  ( HIGH · ↓ 128 · 00:12 )
```

- Fixed-width dots, slow cycle
- Effort: MINIMAL→MAX, tier-colored, stable for the turn
- Tokens: sky `↑/↓` + number (no padding holes)
- Outer `( … )` with inner ` · ` (upstream pi-claude-shimmer layout)

**History**

```text
  ✦ Thought trail
  ├─ ◇ …
  ╰─ ◇ …

╭─ ✓ READ · COMPLETE ─╮
┃ read  /path/to/file │
╰─────────────────────╯
```

- Thought trail: tight spacing (no double blank stack)
- Tool frames: symmetric sakura frame gradient (ends match); no per-line trailing `...`
- Tool titles: no leading ◎ glyph; snake_case tools colored; paths sakura
- Left rail: sky (running) / mint (ok) / coral (error)

## Requirements

- Pi `>= 0.80`
- Truecolor terminal
- Nerd Font for configured icons

## Install

```bash
pi install git:github.com/beautifulrem/pi-sakura-cyberdeck
```

Local:

```bash
pi install /path/to/pi-sakura-cyberdeck
```

Then `/settings` → **sakura-macaron**. Restart Pi once.

> Prefer **this package’s shimmer** over stock `npm:pi-claude-shimmer`, and turn off `sakura-matrix` if both fight for the working indicator.

Recommended companion settings (optional, user-owned):

```jsonc
// ~/.pi/agent/zentui.json (excerpt)
{
  "colors": {
    "contextNormal": "syntaxFunction",
    "cost": "mdCode",
    "editorBorder": "sakura-macaron-gradient"
  }
}
```

## Commands

```text
/zentui                         editor/footer settings
/sakura-matrix                 rain status
/sakura-matrix on|off
/dual-usage                    refresh Codex+Grok quotas
```

## Conflicts

Avoid stacking with `pi-zentui`, `pi-powerline-footer`, `@tifan/pi-fixed-editor`, stock `pi-claude-shimmer`, or a second copy of this pack. They share footer / working / editor surfaces.

## Changelog

### 1.1.1

- **Tool cards**: stop right-edge `...` on every body line (Box pad broke diff parse; re-box from plain only; `truncateToWidth` ellipsis forced empty)
- **Diff body**: Pi-native `±12 text` — no extra `│` gutters eating width
- **Context gauge**: solid butter (warning) / coral (error) at high %; no healthy pink at 85–90%
- **Tool left rail**: sky / mint / coral status cues (macaron, not traffic-light RGB)
- **Self-shell tools** (edit): also polished + framed
- **Startup**: deferred dual-quota / project refresh / web-access / chrome bridge / subagents (from 1.1.0 follow-ups)

### 1.1.0

- Macaron truecolor footer: gradient separators, pulsed context gauge, sky context text + peach cost
- Fixed-editor: keep one blank above working spinner so it does not glue to history
- Thought trail: sakura chrome, tight vertical spacing
- Tool cards: symmetric frame gradient, path/title color consistency, no icon prefix on `read`
- Bundled dual-quota chips (`· in Nd`) and sakura Claude shimmer (effort HUD + verb list)
- Defaults: context/cost colors no longer mint-on-gradient clash

### 1.0.0

- Initial theme, header, matrix, zentui pack

## License

MIT. Bundled dual-quota is original to this pack. Claude shimmer is a sakura-themed fork of [pi-claude-shimmer](https://github.com/ouzhenkun/pi-claude-shimmer) (MIT).
