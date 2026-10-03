# AGENTS.md

Documentation lives in `README.md` (install, mods, labels, limits, development). This file
holds instructions only.

- Use the official mod API only (function hooks, `$` nouns, built-in tools); never read
  undocumented Claude Code files or formats.
- Keep the plugins general: nothing specific to one machine, user or setup.
- New mod = new folder under `plugins/` plus an entry in `.claude-plugin/marketplace.json`;
  the entry's name is the `name` in its `plugin.json`.
- Before every commit: `claude plugin validate .`, and for each changed plugin
  `claude plugin validate plugins/<name>` and `claude plugin test plugins/<name>`.
- Bump `version` in the changed plugin's `plugin.json` for every change users should get
  (semver); users stay on their cached copy until it changes. Never set `version` in
  `marketplace.json` too.
- `AbovePrompt` render hooks call `next(e)` and keep its drawing instead of replacing it.
- Code, comments, commits and docs in English; Conventional Commits.
- No push without explicit approval.
