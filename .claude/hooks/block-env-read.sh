#!/bin/bash
# Claude Code hook: stop any shell command that names a .env file
# (e.g. "cat .env.local"), so the API key in .env.local is never shown.
# Claude Code sends the command as JSON on stdin; exit code 2 = block it.
# Fail safe: if jq is missing or the input can't be read, block the command.

JQ=/usr/bin/jq
if [ ! -x "$JQ" ]; then
  echo "Blocked: /usr/bin/jq is missing, so this hook can't check the command for .env files." >&2
  exit 2
fi

if ! command=$("$JQ" -r '.tool_input.command // ""'); then
  echo "Blocked: couldn't read the command to check it for .env files." >&2
  exit 2
fi

if printf '%s' "$command" | grep -Eq '(^|[^A-Za-z0-9_-])\.env'; then
  echo "Blocked: this command names a .env file. .env files hold secrets and must not be read." >&2
  exit 2
fi
exit 0
