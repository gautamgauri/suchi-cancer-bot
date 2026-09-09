#!/usr/bin/env bash
# Test harness for git-preflight.sh (issue #102).
#
# There is no jest for shell hooks, so this is the regression proof: it builds a
# throwaway repo with a linked `git worktree`, feeds the hook real PreToolUse
# payloads, and asserts the exit code. Crucially, every case runs the hook with
# its own $PWD set to the PRIMARY checkout, which is how Claude Code invokes it
# (settings.json: `bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/git-preflight.sh"`).
# That is what makes the #102 cases fail against the pre-fix hook and pass after.
#
# Usage: bash .claude/hooks/git-preflight.test.sh
# Exit 0 = all passed.

set -u

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/git-preflight.sh"
[ -f "$HOOK" ] || { echo "hook not found: $HOOK" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PRIMARY="$TMP/primary"
LINKED="$TMP/linked"

git init -q -b main "$PRIMARY"
git -C "$PRIMARY" config user.email t@example.com
git -C "$PRIMARY" config user.name  Test
echo base > "$PRIMARY/tracked.txt"
git -C "$PRIMARY" add tracked.txt
git -C "$PRIMARY" commit -qm "base"
git -C "$PRIMARY" worktree add -q -b feature "$LINKED"

# The destructive commands under test are assembled from fragments so that this
# harness does not itself trip the hook when an agent edits it.
RESET="git re""set --hard HEAD"
FPUSH="git pu""sh --force origin"
GCLEAN="git cl""ean -fd"
RESTORE_FILE="git re""store tracked.txt"

pass=0
fail=0
LAST_OUT=""

# run <name> <expected_exit> <cwd> <command>
run() {
  local name="$1" want="$2" cwd="$3" command="$4" out got payload
  payload="$(cwd="$cwd" command="$command" python3 -c 'import json, os
print(json.dumps({
    "hook_event_name": "PreToolUse",
    "tool_name": "Bash",
    "cwd": os.environ["cwd"],
    "tool_input": {"command": os.environ["command"]},
}))')"
  # $PWD is the primary checkout for every case: that is how the hook is launched.
  out="$(cd "$PRIMARY" && printf '%s' "$payload" | bash "$HOOK" 2>&1)"
  got=$?
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
    printf 'ok   %s (exit %s)\n' "$name" "$got"
  else
    fail=$((fail + 1))
    printf 'FAIL %s: expected exit %s, got %s\n%s\n' "$name" "$want" "$got" "$out"
  fi
  LAST_OUT="$out"
}

# assert_mentions <needle> <label> -- checked against the last run's output
assert_mentions() {
  case "$LAST_OUT" in
    *"$1"*) pass=$((pass + 1)); printf 'ok   %s\n' "$2" ;;
    *) fail=$((fail + 1)); printf 'FAIL %s\n%s\n' "$2" "$LAST_OUT" ;;
  esac
}

# --- baseline behaviour that must not regress ------------------------------

run "non-git command is ignored"          0 "$PRIMARY" "ls -la"
run "non-destructive git is ignored"      0 "$PRIMARY" "git status --short"
run "prose mentioning a destructive verb" 0 "$PRIMARY" "git commit -m 'note: the hook blocks $RESET'"
run "destructive command, clean tree"     0 "$PRIMARY" "$RESET"

# --- a dirty tree still blocks (acceptance #2) -----------------------------

echo dirty > "$PRIMARY/tracked.txt"
run "dirty tree blocks"                   2 "$PRIMARY" "$RESET"
assert_mentions "$PRIMARY" "block message names the primary tree"
run "dirty tree blocks path restore"      2 "$PRIMARY" "$RESTORE_FILE"

# --- issue #102: a clean worktree is NOT blocked by primary dirt -----------
# The primary checkout is dirty (above); the linked worktree is clean. The
# pre-#102 hook inspected its own $PWD (= primary) and blocked both of these.

run "#102 force-push from clean worktree" 0 "$LINKED"  "$FPUSH feature"
run "#102 destructive in clean worktree"  0 "$LINKED"  "$RESET"

# --- the linked worktree's own dirt does block, and is named ---------------

echo wip > "$LINKED/tracked.txt"
run "dirty linked worktree blocks"        2 "$LINKED"  "$RESET"
assert_mentions "$LINKED" "block message names the linked worktree"

# --- explicit `git -C <dir>` / `cd <dir> &&` target the named tree ---------

git -C "$PRIMARY" checkout -q -- tracked.txt   # primary clean, linked still dirty
run "git -C targets the named dirty tree" 2 "$PRIMARY" "git -C $LINKED $RESET"
run "cd <dir> && targets that tree"       2 "$PRIMARY" "cd $LINKED && $RESET"

# --- acceptance #3: force-push to a branch another dirty worktree holds ----
# Run from the clean primary, pushing 'feature' -- which the dirty linked
# worktree has checked out. Must still block.

run "force-push to a dirty worktree's branch" \
                                          2 "$PRIMARY" "$FPUSH feature"
assert_mentions "$LINKED" "cross-worktree block names the linked worktree"
run "force-push to an unrelated branch"   0 "$PRIMARY" "$FPUSH main"

# --- untracked files: only the clean subcommand can destroy them -----------

git -C "$LINKED" checkout -q -- tracked.txt    # both trees tracked-clean
echo junk > "$LINKED/untracked.txt"
run "destructive command ignores untracked" \
                                          0 "$LINKED"  "$RESET"
run "clean -fd blocks on untracked"       2 "$LINKED"  "$GCLEAN"

# --- a payload with no cwd degrades to the hook's own $PWD, not to "allow" --

echo dirty > "$PRIMARY/tracked.txt"
run "no cwd in payload falls back to \$PWD" \
                                          2 ""         "$RESET"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
