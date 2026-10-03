#!/usr/bin/env bash
# Registers this repo as the local Claude Code marketplace "claude-mods" and
# installs every plugin it lists. Idempotent: safe to run again.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
marketplace="claude-mods"

if ! command -v claude >/dev/null 2>&1; then
	echo "claude not found — install Claude Code first" >&2
	exit 1
fi

if claude plugin marketplace list 2>/dev/null | grep -q "❯ ${marketplace}\$"; then
	echo "marketplace ${marketplace} already registered"
else
	claude plugin marketplace add "$here"
fi

installed="$(claude plugin list 2>/dev/null || true)"
plugins="$(python3 -c 'import json,sys; print("\n".join(p["name"] for p in json.load(open(sys.argv[1]))["plugins"]))' \
	"${here}/.claude-plugin/marketplace.json")"

while read -r plugin; do
	[[ -z "$plugin" ]] && continue
	if grep -q "❯ ${plugin}@${marketplace}\$" <<<"$installed"; then
		echo "${plugin}@${marketplace} already installed"
	else
		claude plugin install "${plugin}@${marketplace}"
	fi
done <<<"$plugins"
