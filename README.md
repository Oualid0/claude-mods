# claude-mods

Mods for the Claude Code terminal: a band of rings above the prompt that shows your limits,
this chat's usage and the prompt cache, plus a board of your running Claude sessions.

## Quick install

Copy this prompt into Claude Code:

```text
Install the Claude Code plugins from https://github.com/Oualid0/claude-mods:
add the repo as a plugin marketplace, then install every plugin listed in its
.claude-plugin/marketplace.json, and tell me to run /reload-plugins when done.
```

## Manual install

```bash
claude plugin marketplace add Oualid0/claude-mods
claude plugin install usage-ring@claude-mods
claude plugin install session-board@claude-mods
```

Then run `/reload-plugins` in Claude Code, or start a new session. From a local clone,
`./install.sh` does the same (it needs `python3`) and is safe to run again.

## Update

Auto-update is off by default. Update by hand with `/plugin marketplace update claude-mods`
in a session, or `claude plugin update usage-ring@claude-mods` and
`claude plugin update session-board@claude-mods` in the shell. You can also turn on
**Enable auto-update** for the marketplace under **Marketplaces** in `/plugin`.

## Mods

| Plugin | What it does |
|---|---|
| `usage-ring` | Two chips right above the prompt: `limits` and `chat`, with a pixel Claude beside them that hammers while a turn runs and sleeps otherwise, and the model in grey next to it, e.g. `Opus 5.5 (mid)` (effort `low`, `mid`, `high`, `xhigh` or `max`, known from the first request on). |
| `session-board` | A `sessions` chip above that while other Claude sessions on this machine are running: one row each (`●` running, `✓` done for 60 s after it finished), plus your own row (`○` ready or `●` running) marked `←`. With no other session running, the board is hidden. |

## What the labels mean

| Label | Chip | Meaning |
|---|---|---|
| `Wk` | limits | Weekly limit used, in percent. |
| `Se` | limits | Session limit (the 5-hour window) used, and the time until it resets: `4:50h`, or `33m` under an hour. Once the window is over it shows `0% 5:00h` until the next reading. |
| `Cx` | chat | Context window used, in percent. |
| `Td` | chat | Todos done out of all, e.g. `3/5`. Only while the chat has a todo list. |
| `Tk` | chat | Tokens this chat used since the session started (input, output, cache reads and writes, subagents included). Grows after every model request. |
| `Co` | chat | What the session cost so far, in US dollars. |
| `Ca` | chat | Time left on the prompt cache (`33m`), `expired` once it lapsed. |

When the terminal is narrow, the least important goes first: the model label, the words `limits` and `chat`, `Ca`, `Co`, `Tk`, `Td`, `Wk`, the pixel Claude, then `Cx`. `Se` stays longest; if not even it fits, the band is hidden. Nothing is squeezed or wrapped.

## Limits

- Needs a Claude Code version with mods (function-hook plugins); tested with Claude Code 2.1.288.
  The mod API is early access and may change between versions.
- Rings are pixel images in kitty and Ghostty; other terminals show a glyph instead.
- `Ca` is an estimate. Claude Code does not tell plugins how long the cache lives (5 minutes
  or 1 hour), so the band assumes 1 hour and learns from what each request read from the
  cache: a hit after a pause of more than 5 minutes means 1 hour, a miss means 5 minutes.
  A miss can also come from a changed system prompt, which the band cannot see.
- `Tk` starts at 0 when a session starts or resumes; earlier tokens of a resumed session are
  not available. `Co` starts with the session's cost.
- `Td` counts `TaskCreate`/`TaskUpdate`/`TaskList` and `TodoWrite`. Newer models only have these
  tools with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`
  ([docs](https://code.claude.com/docs/en/tools-reference#task-tool-availability)).
- The board knows other sessions only as busy or idle; "needs input" is not available.
  Sessions without a name are hidden.
- The board reads the session list from the `ListAgents` tool every 5 s. Its output is text
  for the model, not a fixed format: if a Claude Code update changes it, the board stays empty
  instead of showing an error.

## Options

`usage-ring` has one option, off by default:

| Option | Meaning |
|---|---|
| `limitsFile` | Write the session and weekly limits to `$CLAUDE_CONFIG_DIR/usage-limits.json` (default `~/.claude`) for other tools to read. |

Set it with `/plugin configure usage-ring@claude-mods` in Claude Code, or:

```bash
echo '{"limitsFile":"true"}' | claude plugin configure usage-ring@claude-mods --values-stdin
```

## Development

- Each plugin lives in `plugins/<name>/`: `.claude-plugin/plugin.json`, `hooks/hooks.json`,
  `hooks/register.tsx` with the hooks, pure logic in files beside it, `types/index.d.ts` (the
  state contract) and `tests/`.
- Check: `claude plugin validate .`, then `claude plugin validate plugins/<name>` and
  `claude plugin test plugins/<name>`.
- Installed from a local clone, Claude Code reads the files in place: changes apply with
  `/reload-plugins` or the next session.
- Both mods draw into the same band above the prompt; each render hook calls `next(e)` and
  keeps what is beneath (`session-board` on top, `usage-ring` next to the prompt).

## License

MIT, see [LICENSE](LICENSE).
