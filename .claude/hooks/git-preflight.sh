#!/usr/bin/env bash
# PreToolUse(Bash) guard: block DESTRUCTIVE git commands when work is at risk,
# unless it is already preserved in a stash. Added after a `git reset --hard`
# silently wiped uncommitted WIP.
#
# Reads the hook payload (JSON) on stdin; the Bash command is tool_input.command
# and the invoking directory is the payload's top-level `cwd`.
# Exit 0 = allow. Exit 2 = block (stderr is shown to the model).

input="$(cat)"

# Parse the payload once. Emits four fields, one per line, command last (it may
# be multi-line, so it has to be the tail):
#   1: cwd        - the directory the Bash tool runs the command from
#   2: dir_hint   - explicit target dir from `git -C <dir>` or a leading `cd <dir> &&`
#   3: push_ref   - refspec of a `git push`, used for the cross-worktree check
#   4+: command
# shellcheck disable=SC2016  # the python source is deliberately unexpanded
payload="$(printf '%s' "$input" | python3 -c 'import sys, json, re
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
if not isinstance(d, dict):
    d = {}
cmd = ((d.get("tool_input") or {}).get("command") or "")
cwd = (d.get("cwd") or "")

# Where will the command actually run? An explicit `git -C <dir>` or a leading
# `cd <dir> &&` overrides the payload cwd.
hint = ""
m = re.search(r"\bgit\s+(?:-c\s+\S+\s+)*-C\s+(\S+)", cmd)
if m:
    hint = m.group(1)
else:
    m = re.match(r"\s*cd\s+([^\s;&|]+)\s*(?:&&|;)", cmd)
    if m:
        hint = m.group(1)
hint = hint.strip("\"" + chr(39))

# Refspec of a push, if any: the second non-flag token after `push` (the first is
# the remote). Stop at a command separator so `&& echo ...` is not consumed.
push_ref = ""
m = re.search(r"\bgit\b[^\n;&|]*?\bpush\b([^\n;&|]*)", cmd)
if m:
    toks = [t for t in m.group(1).split() if not t.startswith("-")]
    if len(toks) >= 2:
        push_ref = toks[1]

print(cwd)
print(hint)
print(push_ref)
sys.stdout.write(cmd)' 2>/dev/null)"

cwd_hint="$(printf '%s\n' "$payload" | sed -n '1p')"
dir_hint="$(printf '%s\n' "$payload" | sed -n '2p')"
push_ref="$(printf '%s\n' "$payload" | sed -n '3p')"
cmd="$(printf '%s\n' "$payload" | sed -n '4,$p')"

# Fast path: ignore anything that is not a git command.
printf '%s' "$cmd" | grep -Eq '(^|[^a-zA-Z])git[[:space:]]' || exit 0

d=0          # matched a destructive command
is_clean=0   # the command is `git clean` (also endangers untracked files)
is_push=0    # the command is a force-push (cross-worktree branch check applies)
# Patterns require the destructive subcommand to follow `git` directly (no `.*`
# gap) so prose in a commit message ("...blocks git on reset --hard...") never matches.
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+reset[[:space:]]+--hard'                                          && d=1
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f'                                     && { d=1; is_clean=1; }
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+checkout[[:space:]]+(-f|--force|--theirs|--ours|--[[:space:]])'   && d=1
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+switch[[:space:]]+(-f|--force|--discard-changes)'                 && d=1
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+branch[[:space:]]+-D'                                             && d=1
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+stash[[:space:]]+(drop|clear)'                                    && d=1
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push[[:space:]].*(--force([^-]|$)|--force-with-lease|[[:space:]]-f([[:space:]]|$))' && { d=1; is_push=1; }
# `git restore <path>` discards worktree changes; `restore --staged` only unstages (safe).
if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+restore' && ! printf '%s' "$cmd" | grep -Eq 'restore[[:space:]]+--staged([[:space:]]|$)'; then d=1; fi

[ "$d" -eq 1 ] || exit 0

# Resolve the work tree the command will actually run in (#102). The hook
# process itself is launched from the primary checkout (settings.json invokes it
# via ${CLAUDE_PROJECT_DIR}), so the hook's own $PWD is NOT the tree at risk when
# Claude Code is working inside a `git worktree`. Try, in order: an explicit
# `git -C`/`cd` target, the payload cwd, then the hook's own $PWD as a last
# resort -- so a payload without `cwd` degrades to the previous behaviour rather
# than to "allow".
target_tree=""
for candidate in "$dir_hint" "$cwd_hint" "$PWD"; do
  [ -n "$candidate" ] || continue
  case "$candidate" in
    /*) probe="$candidate" ;;
    -*) continue ;;
    *)  probe="${cwd_hint:-$PWD}/$candidate" ;;   # a relative hint is relative to cwd
  esac
  top="$(git -C "$probe" rev-parse --show-toplevel 2>/dev/null)" || continue
  [ -n "$top" ] || continue
  target_tree="$top"
  break
done

# Only meaningful inside a git work tree.
[ -n "$target_tree" ] || exit 0

status="$(git -C "$target_tree" status --short 2>/dev/null)"
tracked_dirty="$(printf '%s\n' "$status" | grep -vE '^\?\?' | grep -v '^$')"

# What this command can destroy: tracked modifications for all; clean also eats untracked.
at_risk="$tracked_dirty"
[ "$is_clean" -eq 1 ] && at_risk="$(printf '%s\n' "$status" | grep -v '^$')"

if [ -n "$at_risk" ]; then
  # Block. Preservation = make the tree clean (stash -u / commit) -- that is the
  # robust signal. We deliberately do NOT treat "a stash exists" as preserved: a
  # stale, unrelated stash would silently defeat the guard.
  {
    echo "BLOCKED (git-preflight): destructive git command with unpreserved changes."
    echo "Tree inspected: $target_tree"
    echo "Preserve first - 'git stash -u' or commit to a WIP branch (cleans the tree) - then retry."
    echo "At-risk changes this command would destroy:"
    printf '%s\n' "$at_risk"
  } >&2
  exit 2
fi

# The invoking tree is clean. A force-push is still destructive for a branch that
# ANOTHER linked worktree has checked out with unpreserved changes on it, so check
# those too -- that is the one cross-tree case the command can genuinely destroy.
[ "$is_push" -eq 1 ] || exit 0

branch="${push_ref#+}"
branch="${branch##*:}"
branch="${branch#refs/heads/}"
if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
  branch="$(git -C "$target_tree" rev-parse --abbrev-ref HEAD 2>/dev/null)"
fi
[ -n "$branch" ] && [ "$branch" != "HEAD" ] || exit 0

other_tree="$(git -C "$target_tree" worktree list --porcelain 2>/dev/null | awk -v want="refs/heads/$branch" -v self="$target_tree" '
  /^worktree / { path = substr($0, 10) }
  /^branch /   { if (substr($0, 8) == want && path != self) { print path; exit } }
')"
[ -n "$other_tree" ] || exit 0

other_dirty="$(git -C "$other_tree" status --short 2>/dev/null | grep -vE '^\?\?' | grep -v '^$')"
[ -n "$other_dirty" ] || exit 0

{
  echo "BLOCKED (git-preflight): force-push to '$branch', which another worktree has checked out with unpreserved changes."
  echo "Tree at risk: $other_tree (this tree, $target_tree, is clean)"
  echo "Preserve there first - 'git -C $other_tree stash -u' or commit - then retry."
  echo "At-risk changes:"
  printf '%s\n' "$other_dirty"
} >&2
exit 2
