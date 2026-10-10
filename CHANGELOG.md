# Changelog

All notable changes to the mods in this repository. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Both plugins are at 2.0.0;
earlier entries name the plugin version they belong to.

## 2.0.0 - 2026-10-10

`usage-ring` 2.0.0 and `agent-board` 2.0.0.

**Breaking**

- The `chat` group no longer shows `Tokens` and `Cost`. Tokens moved into their own `tokens`
  group (one `Tokens` entry: the chat's token count and the rate); cost is gone.
- `session-board` was removed (its code is deleted). If you installed it, run
  `claude plugin uninstall session-board@claude-mods`.

### Changed

- Labels are written as full words (`Week`, `Session`, `Context`, `Todos`, `Tokens`,
  `Cache`; agent-board: `Haiku`, `Sonnet`, `Opus`, `Other`, `Split`). When a band is too narrow,
  all its labels switch to the two-letter form first, before anything is dropped.
- usage-ring: the band is one frame with up to three groups separated by a dimmed ` │ `:
  `limits` (Week, Session), `chat` (Context, Cache, Todos) and, with `showTokens`, `tokens`
  (one entry, e.g. `Tokens 39.5M  6k tok/s`: the count and the rate). Only Week, Session and
  Context have a ring; Todos is plain text such as `1/2`, and times are written without an
  `h` (`4:50`, a fresh window `5:00`).
- usage-ring: the `tokens` group, the group titles `limits`, `chat` and `tokens` and the model
  label are hidden by default (see the options under Added).
- usage-ring: Context turns yellow from 50% and red from 80%.
- usage-ring: a value of 0 is a fixed muted terracotta (`#9a5a44`, not bold): `0%` of Week,
  Session or Context, a Todos count with none done, and with `showTokens` a total of 0 or
  `0 tok/s`. From above 0 it has its normal color, and warning and alert colors win. The Cache
  text has no zero case.
- usage-ring: Cache is text, not a ring: the time left, with warning thresholds scaled to the
  cache's lifetime (1-hour entry: yellow under 10 minutes, red under 3; 5-minute entry: yellow
  under 2 minutes, red under 1). It shows seconds in the last minute and a red `cold` after
  expiry, a model switch or a compaction. A cold entry teaches the band nothing about the
  cache's lifetime.
- usage-ring: Cache and the Tokens figures (count and rate) start over on `/clear` and on
  resume. Todos start over on `/clear`; on resume they show the resumed chat's own task list. Context is reset on both until
  the next measurement.
- usage-ring: no frame flash on hammer hits; new drop order on narrow terminals (two-letter
  labels first, then the model label and the titles if shown, then (with `showTokens`) the
  rate and the Tokens entry, then Cache, Todos, Week, the pixel Claude and Context; Session
  goes last).
- usage-ring: percentages are rounded and held to 0..100, and the band is hidden when not even
  one entry fits.
- usage-ring: the pixel Claude animates fast while a turn runs and slowly (one tick a second)
  while it sleeps.
- usage-ring: the `limitsFile` option also seeds the rings from `usage-limits.json` at session
  start; windows whose reset time has passed, and entries of the wrong type, are skipped.

### Added

- agent-board is new. It replaces `session-board` in the marketplace: a row above the prompt
  for the subagents Claude starts. One chip holds an entry per model family (the family's name dimmed,
  the running count, `running/limit` with the count turning red over a limit, and a
  dimmed done count `✔3` with failed and stopped included, hidden at 0), followed by a token
  bar (`Split`) of how the chat's tokens split by main loop and family, and a pixel crew.
- agent-board: the family colors are Haiku mint `#39ff88`, Sonnet cyan `#22d3ff`, Opus violet
  `#b26bff` and Other grey `#6a6a6a`; they tint the bar. The crew has a hard
  hat in the color of Haiku, Sonnet and Opus (Other has no crew member). The label words are
  dimmed grey like usage-ring's labels, and a count is the muted terracotta `#9a5a44` with 0
  running, in the chip color from 1 and red over a limit. Every non-zero share in the bar gets
  at least one cell.
- agent-board: a limit counts only as a whole number from 1 up; `0`, negatives, fractions and
  blanks mean no limit. The row hides 5 minutes after the last subagent ended (`hideAfter`; an
  invalid value falls back to 5 minutes). The crew redraws once a second while all workers
  sleep. On narrow terminals it drops the long names, the titles, the bar, the done counts and
  the crew, in that order.
- usage-ring options `showTokens` (the `tokens` group; without it there is no tokens group at
  all, not even its title), `showModel` (the model and effort next to the pixel Claude),
  `titles` (the group titles) and `compact` (always the two-letter labels); all off by default.
- agent-board options `titles` (the words `agents` and `Split`), `compact` (always the
  two-letter family names) and `hideUnused` (a family shows only once it had a subagent; by
  default Haiku, Sonnet and Opus always show); all off by default.
- agent-board: a worker whose running subagents have all produced no tokens for 5 minutes looks
  at a clock and taps its foot (waiting).
- agent-board: a subagent that is not in the engine's agent list (such as a workflow's) and
  sends no tokens for 30 minutes counts as done; a later request revives it.
- usage-ring: the `tokens` group (option `showTokens`, off by default) with a `Tokens` entry
  (all tokens of the chat, and the rate in `tok/s`).

### Fixed

- Starting a session again no longer adds a second set of timers. usage-ring's frame clock keeps
  running across `/clear` and resume and stops on any other end of a session; agent-board stops
  its sync and frame timers when a session ends and starts new ones for a chat that goes on
  after `/clear` or resume.
- A failing hook (spawn bookkeeping, todo tools, model switch, compaction) no longer breaks the
  call it only watches; and a failing step at session start no longer stops the later steps.
- agent-board: image keys carry the plugin's name, so an equal key from another plugin cannot
  refuse the whole band.
- A failing agent list no longer stops agent-board from judging silent subagents.
- usage-ring: a single cache miss after a prompt change (for example `/reload-plugins`) no longer
  makes the cache look cold after 5 idle minutes: the 5-minute lifetime is learned only after two
  telling misses in a row, a telling hit sets 1 hour at once, and on a model switch the lifetime
  the engine names (`5m` or `1h`) is taken.

### Removed

- `session-board` (see Breaking).
- The `Tokens` and `Cost` entries of the `chat` group.

## usage-ring 1.0.1 - 2026-10-04

### Fixed

- The context estimate and a cache placeholder show in a fresh chat, before the first response.
- The week, session and context rings turn red from 95%, and the cache time turns red in its
  last 3 minutes.

## 1.0.0 - 2026-10-03

Initial release (tag `v1.0.0`) of `usage-ring` and `session-board`.

### Added

- usage-ring: the account limits and this chat's usage in two chips above the prompt (week,
  session, context, todos, tokens, cost, prompt cache), with a pixel Claude and the model and
  effort beside them. It drops the least important items first on narrow terminals and can write
  `usage-limits.json` as an opt-in option.
- session-board: lists the running Claude sessions on this machine with the own todo ring.
