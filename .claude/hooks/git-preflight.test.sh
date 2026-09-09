#!/usr/bin/env bash
# Test harness for git-preflight.sh (issue #102, PR #104 review).
#
# There is no jest for shell hooks, so this is the regression proof: it builds a
# throwaway repo with a linked `git worktree`, feeds the hook real PreToolUse
# payloads, and asserts the exit code. Crucially, every case runs the hook with
# its own $PWD set to the PRIMARY checkout, which is how Claude Code invokes it
# (settings.json: `bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/git-preflight.sh"`).
# That is what makes the #102 cases fail against the pre-fix hook and pass after.
#
# Usage: bash .claude/hooks/git-preflight.test.sh
#        GIT_PREFLIGHT_HOOK=<path> bash .claude/hooks/git-preflight.test.sh
# The override exists so a case can be demonstrated red against an older copy of
# the hook before the fix lands.
# Exit 0 = all passed.

set -u

HOOK="${GIT_PREFLIGHT_HOOK:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/git-preflight.sh}"
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
# harness does not itself trip the hook when an agent edits it. They are
# SUBCOMMAND-ONLY: every case spells out the `git` word itself, so that
# `git -C <dir> <subcommand>` is Git's real syntax and not the nonsense
# `git -C <dir> git <subcommand>` (PR #104 review, P1).
RESET="re""set --hard HEAD"
FPUSH="pu""sh --force origin"
GCLEAN="cl""ean -fd"
RESTORE_FILE="re""store tracked.txt"
RESTORE_STAGED="re""store --staged tracked.txt"
CHECKOUT_F="check""out -f main"
SWITCH_D="swi""tch --discard-changes"
BRANCH_D="bra""nch -D scratch"
STASH_DROP="sta""sh drop"

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
run "destructive command, clean tree"     0 "$PRIMARY" "git $RESET"
run "git -C at a clean tree is allowed"   0 "$PRIMARY" "git -C $LINKED $RESET"

# --- a dirty tree still blocks (acceptance #2) -----------------------------

echo dirty > "$PRIMARY/tracked.txt"
run "dirty tree blocks"                   2 "$PRIMARY" "git $RESET"
assert_mentions "$PRIMARY" "block message names the primary tree"
run "dirty tree blocks path restore"      2 "$PRIMARY" "git $RESTORE_FILE"
run "restore --staged is not destructive" 0 "$PRIMARY" "git $RESTORE_STAGED"

# Prose quoting a destructive verb inside a commit message must never match --
# and a commit is precisely when the tree IS dirty, so the clean-tree version of
# this case proved nothing.
run "prose in a commit message on a dirty tree" \
                                          0 "$PRIMARY" "git commit -m 'note: the hook blocks git $RESET'"
# ...but a destructive git call wrapped in another program is still caught.
run "wrapped destructive command blocks"  2 "$PRIMARY" "bash -c \"git $RESET\""

# --- issue #102: a clean worktree is NOT blocked by primary dirt -----------
# The primary checkout is dirty (above); the linked worktree is clean. The
# pre-#102 hook inspected its own $PWD (= primary) and blocked both of these.

run "#102 force-push from clean worktree" 0 "$LINKED"  "git $FPUSH feature"
run "#102 destructive in clean worktree"  0 "$LINKED"  "git $RESET"

# --- real `git -C <dir> <subcommand>` syntax, every destructive verb -------
# cwd is the CLEAN linked worktree; the command targets the DIRTY primary.
# Against the pre-fix hook every one of these exits 0, because the patterns
# required the subcommand to follow `git` with no global options in between.

run "-C reset --hard blocks"              2 "$LINKED"  "git -C $PRIMARY $RESET"
assert_mentions "$PRIMARY" "-C block message names the -C tree"
run "-C clean -fd blocks"                 2 "$LINKED"  "git -C $PRIMARY $GCLEAN"
run "-C checkout -f blocks"               2 "$LINKED"  "git -C $PRIMARY $CHECKOUT_F"
run "-C switch --discard-changes blocks"  2 "$LINKED"  "git -C $PRIMARY $SWITCH_D"
run "-C branch -D blocks"                 2 "$LINKED"  "git -C $PRIMARY $BRANCH_D"
run "-C stash drop blocks"                2 "$LINKED"  "git -C $PRIMARY $STASH_DROP"
run "-C restore <path> blocks"            2 "$LINKED"  "git -C $PRIMARY $RESTORE_FILE"
run "-C force-push blocks"                2 "$LINKED"  "git -C $PRIMARY $FPUSH main"
run "-C with other global options blocks" 2 "$LINKED"  "git -c core.pager=cat -C $PRIMARY $RESET"
run "attached -C<dir> form blocks"        2 "$LINKED"  "git -C$PRIMARY $RESET"
run "-C restore --staged is allowed"      0 "$LINKED"  "git -C $PRIMARY $RESTORE_STAGED"

# --- compound payloads: the hint must belong to the destructive segment ----
# Primary (payload cwd) is dirty, linked is clean. The pre-fix parser took the
# first `git -C` anywhere in the payload, so it inspected the clean linked tree
# and let the reset erase the primary's WIP.

run "compound: -C on a harmless segment does not move the inspection" \
                                          2 "$PRIMARY" "git -C $LINKED status --short && git $RESET"
assert_mentions "$PRIMARY" "compound block names the tree the reset runs in"

# Flip the dirt: now the primary (payload cwd) is clean and the linked tree is
# dirty. A `-C <dirty>` that belongs only to a harmless segment must NOT block.
git -C "$PRIMARY" checkout -q -- tracked.txt
echo wip > "$LINKED/tracked.txt"

run "compound: dirty tree named only in a harmless segment does not block" \
                                          0 "$PRIMARY" "git -C $LINKED status --short && git $RESET"
run "compound: -C on the destructive segment does target it" \
                                          2 "$PRIMARY" "echo checking && git -C $LINKED $RESET"
run "cd <dir> && targets that tree"       2 "$PRIMARY" "cd $LINKED && git $RESET"
run "cd in an earlier segment carries over" \
                                          2 "$PRIMARY" "cd $LINKED && echo hi && git $RESET"
run "git -C targets the named dirty tree" 2 "$PRIMARY" "git -C $LINKED $RESET"
assert_mentions "$LINKED" "block message names the linked worktree"

# --- acceptance #3: force-push to a branch another dirty worktree holds ----
# Run from the clean primary, pushing 'feature' -- which the dirty linked
# worktree has checked out. Must still block.

run "force-push to a dirty worktree's branch" \
                                          2 "$PRIMARY" "git $FPUSH feature"
assert_mentions "$LINKED" "cross-worktree block names the linked worktree"
run "force-push to an unrelated branch"   0 "$PRIMARY" "git $FPUSH main"
# Same cross-worktree check, reached through `git -C` from the dirty worktree:
# the -C tree is clean, so only the cross-tree branch check can block this.
run "-C force-push hits the cross-worktree check" \
                                          2 "$LINKED"  "git -C $PRIMARY $FPUSH feature"
assert_mentions "$LINKED" "-C cross-worktree block names the linked worktree"

# --- untracked files: only the clean subcommand can destroy them -----------

git -C "$LINKED" checkout -q -- tracked.txt    # both trees tracked-clean
echo junk > "$LINKED/untracked.txt"
run "destructive command ignores untracked" \
                                          0 "$LINKED"  "git $RESET"
run "clean -fd blocks on untracked"       2 "$LINKED"  "git $GCLEAN"
run "-C clean -fd blocks on untracked"    2 "$PRIMARY" "git -C $LINKED $GCLEAN"

# --- a payload with no cwd degrades to the hook's own $PWD, not to "allow" --

echo dirty > "$PRIMARY/tracked.txt"
run "no cwd in payload falls back to \$PWD" \
                                          2 ""         "git $RESET"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
