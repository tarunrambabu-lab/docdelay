#!/bin/bash
# Claude Code hook: after Claude edits or writes a file in src/ (where the app
# code and all the *.test.ts files live), run the automated tests (npm test).
# Claude Code sends details of the edit as JSON on stdin.
#   - File not in src/, or tests pass → exit 0 and say nothing.
#   - Tests fail → exit 2 and show only the last 30 lines of the test output,
#     so Claude sees what broke without flooding the chat.
# The tests never call the AI or the internet, so this can't spend money.

JQ=/usr/bin/jq
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

if [ ! -x "$JQ" ]; then
  echo "test-after-edit: /usr/bin/jq is missing, so the tests were not run." >&2
  exit 1
fi

file_path=$("$JQ" -r '.tool_input.file_path // ""')

# Only files inside src/ count (Claude Code sends the full path).
case "$file_path" in
  "$PROJECT_DIR"/src/* | src/*) ;;
  *) exit 0 ;;
esac

cd "$PROJECT_DIR" || exit 1

# Extra guard: hide the API key from the tests, just in case.
if output=$(env -u ANTHROPIC_API_KEY npm test 2>&1); then
  exit 0
fi

echo "npm test failed after editing ${file_path#"$PROJECT_DIR"/} (last 30 lines):" >&2
printf '%s\n' "$output" | tail -n 30 >&2
exit 2
