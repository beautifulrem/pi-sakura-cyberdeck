# Claude Shimmer Sakura (bundled)

Claude Code–style working spinner, recolored for sakura-macaron.

```text
✻ Whisking...  ( HIGH · ↓ ~1.2k tokens · 00:12 )
```

- One verb per agent run (stable across tool rounds and retries), swept by a soft white highlight over sakura → sky
- Fixed-width `...` dots, so the HUD never shifts
- Status HUD: `( EFFORT · ↑/↓ N tokens · mm:ss )` with ` · ` separators
  - `↑` while waiting for the model, `↓` while it streams
  - Output tokens accumulate across the whole run; `~` marks a live estimate (the provider's final usage replaces it)
- Effort tiers: MINIMAL / LOW / MEDIUM / HIGH / XHIGH / MAX (tier colors); the tag glows while the model thinks
- Stall hint: after ~3s without stream updates the verb fades toward coral
- Tool hint: while a tool runs, the verb pulses toward mint
- Completion notice `✻ Baked for 12s` after successful runs only (nothing after Esc or errors)
- Interactive TUI only; one ~11 Hz clock while the agent works, no timers when idle

Fork of [pi-claude-shimmer](https://github.com/ouzhenkun/pi-claude-shimmer) (MIT).
