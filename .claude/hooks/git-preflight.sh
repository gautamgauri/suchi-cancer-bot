#!/usr/bin/env bash
# PreToolUse(Bash) guard: block DESTRUCTIVE git commands when work is at risk,
# unless it is already preserved in a stash. Added after a `git reset --hard`
# silently wiped uncommitted WIP.
#
# Reads the hook payload (JSON) on stdin; the Bash command is tool_input.command.
# Exit 0 = allow. Exit 2 = block (stderr is shown to the model).

input="$(cat)"
cmd="$(printf '%s' "$input" | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception:
    print("")' 2>/dev/null)"

# Fast path: ignore anything that is not a git command.
printf '%s' "$cmd" | grep -Eq '(^|[^a-zA-Z])git[[:space:]]' || exit 0

d=0          # matched a destructive command
is_clean=0   # the command is `git clean` (also endangers untracked files)
# Patterns require the destructive subcommand to follow `git` directly (no `.*`
# gap) so prose in a commit message ("…blocks git on reset --hard…") never matches.
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+reset[[:space:]]+--hard'                                          && d=1
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f'                                     && { d=1; is_clean=1; }
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+checkout[[:space:]]+(-f|--force|--theirs|--ours|--[[:space:]])'   && d=1
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+switch[[:space:]]+(-f|--force|--discard-changes)'                 && d=1
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+branch[[:space:]]+-D'                                             && d=1
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+stash[[:space:]]+(drop|clear)'                                    && d=1
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push[[:space:]].*(--force([^-]|$)|--force-with-lease|[[:space:]]-f([[:space:]]|$))' && d=1
# `git restore <path>` discards worktree changes; `restore --staged` only unstages (safe).
if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+restore' && ! printf '%s' "$cmd" | grep -Eq 'restore[[:space:]]+--staged([[:space:]]|$)'; then d=1; fi

[ "$d" -eq 1 ] || exit 0

# Only meaningful inside a git work tree.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

status="$(git status --short 2>/dev/null)"
tracked_dirty="$(printf '%s\n' "$status" | grep -vE '^\?\?' | grep -v '^$')"
untracked="$(printf '%s\n' "$status" | grep -E '^\?\?')"

# What this command can destroy: tracked modifications for all; clean also eats untracked.
at_risk="$tracked_dirty"
[ "$is_clean" -eq 1 ] && at_risk="$status"
[ -n "$at_risk" ] || exit 0

# Block. Preservation = make the tree clean (stash -u / commit) — that is the
# robust signal. We deliberately do NOT treat "a stash exists" as preserved: a
# stale, unrelated stash would silently defeat the guard.
{
  echo "BLOCKED (git-preflight): destructive git command with unpreserved changes."
  echo "Preserve first — 'git stash -u' or commit to a WIP branch (cleans the tree) — then retry."
  echo "At-risk changes this command would destroy:"
  printf '%s\n' "$at_risk"
} >&2
exit 2
