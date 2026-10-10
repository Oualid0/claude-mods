# claude-mods

Mods for the Claude Code terminal: a band above the prompt that shows your limits, this chat's
usage and the prompt cache, plus a row for the subagents Claude starts.

## Quick install

Copy this prompt into Claude Code:

```text
Install the Claude Code plugins from https://github.com/Oualid0/claude-mods:
add the repo as a plugin marketplace and install usage-ring. Then ask me whether
I also want agent-board (a row above the prompt that shows the subagents Claude
starts) and install it only if I say yes. If I do, ask whether I want to set
subagent limits (maxHaiku, maxSonnet, maxOpus); recommend leaving them unset if
I don't know my limits, and set only the numbers I give you. Finally tell me to
run /reload-plugins.
```

## Manual install

```bash
claude plugin marketplace add Oualid0/claude-mods
claude plugin install usage-ring@claude-mods
claude plugin install agent-board@claude-mods
```

Then run `/reload-plugins` in Claude Code, or start a new session. From a local clone,
`./install.sh` (it needs `python3`) registers the clone as the marketplace `claude-mods`
(unless a marketplace of that name is already added, from GitHub or elsewhere) and installs the
plugins that are not installed yet. It is safe to run again but does not
update installed plugins.

## Update

Auto-update is off by default. Update by hand with `/plugin marketplace update claude-mods`
in a session, or `claude plugin update usage-ring@claude-mods` and
`claude plugin update agent-board@claude-mods` in the shell. You can also turn on
**Enable auto-update** for the marketplace under **Marketplaces** in `/plugin`.

## Mods

| Plugin | What it does |
|---|---|
| `usage-ring` | One frame right above the prompt with up to three groups, separated by a dimmed ` │ `: `limits` (Week, Session), `chat` (Context, Cache, Todos) and, only with `showTokens`, `tokens` (the chat's token count and rate). A pixel Claude stands beside the frame, hammering while a turn runs and sleeping otherwise (fast animation while it hammers, one slow step a second while it sleeps). Options add the tokens group (`showTokens`), the group titles (`titles`), the model in grey next to the pixel Claude, e.g. `Opus 5.5 (mid)` (`showModel`; effort `low`, `mid`, `high`, `xhigh` or `max`, known from the first request on), and always-short labels (`compact`). |
| `agent-board` | A row right above the usage-ring band, shown once a subagent has started in this chat: one chip with an entry per model family (`Haiku`, `Sonnet`, `Opus`; `Other` only once used), a bar of how the tokens split, and a pixel crew beside it, one hard-hatted worker each for Haiku, Sonnet and Opus (`Other` has none) that works while the family has a subagent running and sleeps otherwise. A worker whose running subagents have all produced no tokens for 5 minutes looks at a clock and taps its foot (waiting). Five minutes after the last subagent ended the row hides, and it comes back with the next one, counts kept. For the single subagents, use Claude Code's own agent list below the prompt. |

`session-board` was removed in 2.0 and is no longer part of this marketplace. If you installed it earlier, remove it with `claude plugin uninstall session-board@claude-mods`.

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

## What the labels mean

| Label | Group | Meaning |
|---|---|---|
| `Week` (`Wk`) | limits | Weekly limit used, in percent, as a ring and a number. Red from 95%. |
| `Session` (`Se`) | limits | Session limit (the 5-hour window) used, as a ring and a number, and the time until it resets: `4:50` (hours:minutes), or `33m` under an hour. Red from 95%. Once the window is over it shows `0% 5:00` until the next reading. |
| `Context` (`Cx`) | chat | Context window used, in percent, as a ring and a number. Yellow from 50%, red from 80%. |
| `Cache` (`Ca`) | chat | The prompt cache as text, no ring: the time left (`33m`, in the last minute `45s`). With a 1-hour cache it turns yellow under 10 minutes and red under 3; with a 5-minute cache yellow under 2 minutes and red under 1. A red `cold` once the cache is gone: its lifetime ran out, the model was switched, or the chat was compacted (`/compact` or automatic). A change of effort does not count. The next request warms it again. `–` before the first request. |
| `Todos` (`Td`) | chat | Todos done out of all, as plain text, e.g. `3/5`. Only while the chat has a todo list. In a muted terracotta (`#9a5a44`, not bold) while none is done (`0/5`). |
| `Tokens` (`Tk`) | tokens | Only with the `showTokens` option; without it there is no `tokens` group and no such entry, and no `tokens` title even with `titles`. One entry with two figures, e.g. `Tokens 39.5M  6k tok/s`. The first is all tokens this chat used since the session started (input, output, cache reads and writes, subagents included); it grows after every model request. The second, after a gap of two spaces, is all tokens of the last minute per second, rounded, with the unit `tok/s` (`800 tok/s`, `6k tok/s`; `0 tok/s` in a pause). |
| `Haiku` / `Sonnet` / `Opus` / `Other` (`Ha` / `So` / `Op` / `Ot`) | agents | Model family of the entry: Haiku, Sonnet, Opus, or `Other` only if a subagent's model fits none of them. The family is guessed from the model name. The label word is dimmed grey, like usage-ring's labels; the family colors are on the `Split` bar and the hats. The entry shows the running subagents, with a limit set as `running/limit` (e.g. `1/15`). The count is a muted terracotta (`#9a5a44`) with 0 running, in the chip color from 1 running, and red above the limit. Haiku, Sonnet and Opus always show once any subagent has started; with `hideUnused`, a family shows only once it had a subagent. |
| `✔` | agents | Subagents of that family not running in this chat (done, failed, stopped, or idle teammates), e.g. `✔3`, dimmed. Hidden while it would be `✔0`. |
| `Split` (`Sp`) | agents | A bar of how this chat's tokens split by who used them: the main loop in terracotta, Haiku neon mint (`#39ff88`), Sonnet neon cyan (`#22d3ff`), Opus neon violet (`#b26bff`), Other grey (`#6a6a6a`). The same colors tint the family's hard hat in the crew (Haiku, Sonnet and Opus; Other has no crew member), not the label words. Every part with tokens gets at least one cell. It shows the split only; the total is in the `tokens` group of `usage-ring` (option `showTokens`). Empty until the first request. The word `Split` itself shows only with the `titles` option. |

A value of 0 is shown in a fixed muted terracotta (`#9a5a44`, not bold) instead of the bright one: `0%` of Week, Session or Context, a Todos count with none done, a subagent count with 0 running, and, with `showTokens`, a total of 0 or a rate of `0 tok/s`. The labels stay grey and the `✔n` done counts stay dimmed. From above 0 a value has its normal color, and the yellow and red warning colors win. The `Cache` text has no zero case.

Labels are full words; the short form in brackets is used once the terminal is too narrow for them, or always with the `compact` option. The group titles `limits`, `chat` and `tokens` show only with the `titles` option, the `tokens` group only with `showTokens`, and the model only with `showModel`.

When the terminal is narrower still, `usage-ring` drops the least important first: the model label, the group titles, then (only with `showTokens`) the rate part of `Tokens` and the whole `Tokens` entry (and with it the `tokens` group), `Ca`, `Td`, `Wk`, the pixel Claude, then `Cx`. `Se` stays longest (without a limit reading, whichever entry is left); if not even one entry fits, the band is hidden. Nothing is squeezed or wrapped.

The `agents` row first shortens its labels, then drops, in this order: the titles `agents` and `Split`, the split bar, the `✔` counts, then the crew. If not even the counts fit, the row is hidden. It is also hidden when the band has fewer than 6 rows to draw in, to leave room for the prompt.

## Limits

- Needs a Claude Code version with mods (function-hook plugins); tested with Claude Code 2.1.296.
  The mod API is early access and may change between versions.
- The rings (`Wk`, `Se`, `Cx`), the split bar and the crew are pixel images in kitty and Ghostty; other terminals show a glyph instead.
- Percentages are rounded and held to 0..100; an entry without a figure is left out.
- The week and session rings turn red from 95%; the context ring turns yellow from 50% and red from 80%; the cache time turns yellow and red as the `Cache` row above says.
- `Ca` is an estimate. Claude Code does not tell plugins how long the cache lives (5 minutes
  or 1 hour) except when the model is switched, where it names the lifetime (`5m` or `1h`) and
  the band takes it. Otherwise the band assumes 1 hour and learns from what each request read
  from the cache after a pause of more than 5 minutes: a hit means 1 hour at once, but only two
  misses in a row mean 5 minutes. A single miss can come from a changed system prompt or tool
  list (for example after `/reload-plugins`), which the band cannot see, so it does not count.
- The `Tokens` figures and `Ca` start over when a session starts or resumes and on `/clear`; earlier
  tokens of a resumed session are not available. `Td` starts over on `/clear` (a new chat); on
  resume (in a session or with `claude --resume`) it shows the resumed chat's own task list.
  `Cx` is also reset on `/clear` and resume until the next measurement.
- `Td` counts `TaskCreate`/`TaskUpdate`/`TaskList` and `TodoWrite`. Newer models only have these
  tools with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`
  ([docs](https://code.claude.com/docs/en/tools-reference#task-tool-availability)).
- `agent-board` syncs each subagent's status from the engine's agent list every 2 s, so a failed
  or stopped subagent may show a moment late. A subagent that drops out of that list without
  ending counts as stopped after two syncs. A subagent that is never in it (a workflow's) keeps
  its status until its turn ends, or counts as done once it has sent no tokens for 30 minutes;
  a later request revives it.
- Its token counts start at 0 when the plugin loads; earlier tokens of a resumed session are not
  available. Tokens of loops it never saw start (the engine's compaction and memory forks) count
  as the main loop's. The row is emptied on `/clear` and when another chat is resumed.
- A subagent that has produced no tokens for 5 minutes still counts as running in the chip; only
  its crew worker waits (clock and tapping foot) once all running subagents of its family are
  silent. One that sits in a single long tool call (over 5 minutes) looks the same.
- The limits are display only: nothing is blocked when more subagents run than the limit.

## Options

`usage-ring` has five options, all off by default:

| Option | Meaning |
|---|---|
| `limitsFile` | Write the session and weekly limits to `$CLAUDE_CONFIG_DIR/usage-limits.json` (default `~/.claude`) for other tools to read. It also seeds the rings from that file when a session starts and the engine has no reading yet; a window whose reset time has passed is skipped. |
| `showModel` | Show the model and its effort in grey next to the pixel Claude, e.g. `Opus 5.5 (mid)`. |
| `showTokens` | Show the `tokens` group: all tokens this chat used and the rate of the last minute (`Tokens 39.5M  6k tok/s`). Without it the group, its entry and its title are not shown. |
| `titles` | Start each group with its title: `limits`, `chat` and (with `showTokens`) `tokens`. |
| `compact` | Always use the two-letter labels (`Wk`, `Se`, `Cx`, `Ca`, `Td`, `Tk`), not only when the terminal is narrow. |

Set them with `/plugin configure usage-ring@claude-mods` in Claude Code, or:

```bash
echo '{"limitsFile":"true","showModel":"true","showTokens":"true","titles":"false","compact":"false"}' | claude plugin configure usage-ring@claude-mods --values-stdin
```

`agent-board` has seven options. The limits are unset by default (only the count), the others are off by default:

| Option | Meaning |
|---|---|
| `maxHaiku` | Limit of Haiku subagents running at once. |
| `maxSonnet` | Limit of Sonnet subagents running at once. |
| `maxOpus` | Limit of Opus subagents running at once. |
| `hideAfter` | Minutes after the last subagent ended until the row hides (default `5`); `0` keeps it shown. A value that is not a number of minutes (negative, blank, text) means `5`. |
| `titles` | Show the words `agents` (the row's title) and `Split` (the bar's label). |
| `compact` | Always write the families as `Ha`, `So`, `Op`, `Ot` (and the bar as `Sp`), not only when the terminal is narrow. |
| `hideUnused` | Show a family only once it had a subagent in this chat (`Other` always needs a subagent of its own); by default Haiku, Sonnet and Opus always show. |

A limit counts only as a whole number from 1 up; `0`, negatives, fractions and blanks mean no limit.

The limits are unset by default. Leave them unset if you don't know how many subagents
you want to allow: the row then shows plain counts and never turns red.

Set them with `/plugin configure agent-board@claude-mods`, or (example values):

```bash
echo '{"maxHaiku":"4","maxSonnet":"2","maxOpus":"1","hideAfter":"5","titles":"false","compact":"false","hideUnused":"false"}' | claude plugin configure agent-board@claude-mods --values-stdin
```

## Development

- Each plugin lives in `plugins/<name>/`: `.claude-plugin/plugin.json`, `hooks/hooks.json`,
  `hooks/register.tsx` with the hooks, pure logic in files beside it, `types/index.d.ts` (the
  state contract) and `tests/`.
- Check: `claude plugin validate .`, then `claude plugin validate plugins/<name>` and
  `claude plugin test plugins/<name>`.
- Installed from a local clone, Claude Code reads the files in place: changes apply with
  `/reload-plugins` or the next session.
- Both mods draw above the prompt; each render hook calls `next(e)` and keeps what is beneath
  (`agent-board`'s row on top, `usage-ring`'s band next to the prompt).

## License

MIT, see [LICENSE](LICENSE).
