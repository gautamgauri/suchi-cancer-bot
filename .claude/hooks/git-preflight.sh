#!/usr/bin/env bash
# PreToolUse(Bash) guard: block DESTRUCTIVE git commands when work is at risk,
# unless it is already preserved in a stash. Added after a `git reset --hard`
# silently wiped uncommitted WIP.
#
# Reads the hook payload (JSON) on stdin; the Bash command is tool_input.command
# and the invoking directory is the payload's top-level `cwd`.
# Exit 0 = allow. Exit 2 = block (stderr is shown to the model).

input="$(cat)"

# Parse the payload once, in python, because the matching has to be structural
# rather than a flat grep over the command text (PR #104 review, two P1s):
#
#   * real git syntax puts global options between `git` and the subcommand
#     (`git -C <dir> reset --hard HEAD`), so a `git[[:space:]]+reset` pattern
#     misses exactly the commands that name another work tree;
#   * each segment of a compound payload runs in its own directory, so a `-C`
#     belonging to a harmless segment must not decide which tree is inspected
#     (`git -C /clean status --short && git reset --hard HEAD` destroys WIP in
#     the payload cwd, not in /clean).
#
# So the parser splits the payload into command segments, tracks `cd` across
# them, and reports one record per DESTRUCTIVE invocation together with the
# directory that invocation itself will run in.
#
# Output: line 1 is the payload cwd; each following line is one destructive
# invocation, TAB-separated: is_clean, is_push, dir, push_ref.
# shellcheck disable=SC2016  # the python source is deliberately unexpanded
findings="$(printf '%s' "$input" | python3 -c 'import sys, json, re, posixpath
try:
    d = json.load(sys.stdin)
except Exception:
    d = {}
if not isinstance(d, dict):
    d = {}
cmd = ((d.get("tool_input") or {}).get("command") or "")
cwd = (d.get("cwd") or "")

QUOTES = "\"" + chr(39)
ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
# A `git` word at the start of the text or after a non-path character.
GIT_WORD = re.compile(r"(?:^|[^A-Za-z0-9_./-])git[ \t]")
# git global options that consume the following token as their value.
GLOBAL_VALUE_OPTS = ("-C", "-c", "--git-dir", "--work-tree", "--namespace",
                     "--exec-path", "--super-prefix", "--config-env")


def split_segments(text):
    """Split a compound command on && || ; | & and newlines, ignoring
    separators that sit inside quotes."""
    segs, cur, quote, i, n = [], [], None, 0, len(text)
    while i < n:
        ch = text[i]
        if quote is not None:
            cur.append(ch)
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in QUOTES:
            quote = ch
            cur.append(ch)
            i += 1
            continue
        if ch == "\\" and i + 1 < n:
            cur.append(ch)
            cur.append(text[i + 1])
            i += 2
            continue
        if text[i:i + 2] in ("&&", "||"):
            segs.append("".join(cur))
            cur = []
            i += 2
            continue
        if ch in ";|&\n":
            segs.append("".join(cur))
            cur = []
            i += 1
            continue
        cur.append(ch)
        i += 1
    segs.append("".join(cur))
    return [s.strip() for s in segs if s.strip()]


def tokenize(text):
    """Word-split a segment, dropping quote characters."""
    toks, cur, quote, quoted = [], [], None, False
    for ch in text:
        if quote is not None:
            if ch == quote:
                quote = None
            else:
                cur.append(ch)
            continue
        if ch in QUOTES:
            quote = ch
            quoted = True
            continue
        if ch.isspace():
            if cur or quoted:
                toks.append("".join(cur))
                cur = []
                quoted = False
            continue
        cur.append(ch)
    if cur or quoted:
        toks.append("".join(cur))
    return toks


def parse_git(toks):
    """toks start AFTER the `git` word. Skip global options to reach the real
    subcommand, capturing a `-C <dir>` on the way.
    Returns (subcommand, args, dir_hint)."""
    i, hint = 0, ""
    while i < len(toks):
        t = toks[i]
        if t == "-C" and i + 1 < len(toks):
            hint = toks[i + 1]
            i += 2
            continue
        if t.startswith("-C") and len(t) > 2:
            hint = t[2:]
            i += 1
            continue
        if t in GLOBAL_VALUE_OPTS:
            i += 2
            continue
        if t.startswith("-"):
            i += 1
            continue
        return t, toks[i + 1:], hint
    return "", [], hint


def classify(sub, args):
    """Returns (destructive, is_clean, is_push, push_ref). is_clean marks
    `git clean`, which also destroys untracked files; is_push marks a
    force-push, for which the cross-worktree branch check applies."""
    if sub == "reset":
        if "--hard" in args:
            return (1, 0, 0, "")
    elif sub == "clean":
        for a in args:
            if re.match(r"^-[a-zA-Z]*f", a):
                return (1, 1, 0, "")
    elif sub == "checkout":
        for a in args:
            if a in ("-f", "--force", "--theirs", "--ours", "--"):
                return (1, 0, 0, "")
    elif sub == "switch":
        for a in args:
            if a in ("-f", "--force", "--discard-changes"):
                return (1, 0, 0, "")
    elif sub == "branch":
        if "-D" in args:
            return (1, 0, 0, "")
    elif sub == "stash":
        for a in args:
            if a.startswith("-"):
                continue
            if a in ("drop", "clear"):
                return (1, 0, 0, "")
            break
    elif sub == "push":
        forced = False
        for a in args:
            if a in ("-f", "--force") or a.startswith("--force-with-lease"):
                forced = True
        if forced:
            # Refspec = second non-flag argument (the first is the remote).
            plain = [a for a in args if not a.startswith("-")]
            return (1, 0, 1, plain[1] if len(plain) >= 2 else "")
    elif sub == "restore":
        # `git restore <path>` discards worktree changes; `restore --staged`
        # only unstages (safe).
        if "--staged" not in args:
            return (1, 0, 0, "")
    return (0, 0, 0, "")


def program_tokens(toks):
    """Drop leading VAR=value assignments to reach the program word."""
    i = 0
    while i < len(toks) and ASSIGN.match(toks[i]):
        i += 1
    return toks[i:]


def cd_target(toks):
    rest = program_tokens(toks)
    if not rest or rest[0] != "cd":
        return None
    for a in rest[1:]:
        if not a.startswith("-"):
            return a
    return None


def resolve(base, path):
    if not path:
        return base
    if path.startswith("/") or path.startswith("~"):
        return path
    if base:
        return posixpath.normpath(posixpath.join(base, path))
    return path


def scan_anywhere(seg):
    """Fallback for a segment whose program is not git (bash -c ..., sudo git
    ..., xargs git ...): treat any git invocation in the text as real.
    Deliberately conservative -- blocking is the safe direction."""
    hits = []
    for m in GIT_WORD.finditer(seg):
        sub, args, hint = parse_git(tokenize(seg[m.end():]))
        res = classify(sub, args)
        if res[0]:
            hits.append((res, hint))
    return hits


lines = [cwd]
cwd_here = cwd
for seg in split_segments(cmd):
    toks = tokenize(seg)
    target = cd_target(toks)
    if target is not None:
        cwd_here = resolve(cwd_here, target)
        continue
    rest = program_tokens(toks)
    hits = []
    if rest and (rest[0] == "git" or rest[0].endswith("/git")):
        # The segment IS a git command: only this invocation counts, so prose
        # inside its arguments (a commit message quoting a destructive verb)
        # never matches.
        sub, args, hint = parse_git(rest[1:])
        res = classify(sub, args)
        if res[0]:
            hits = [(res, hint)]
    elif GIT_WORD.search(seg):
        hits = scan_anywhere(seg)
    for (_d, is_clean, is_push, push_ref), hint in hits:
        lines.append("\t".join([str(is_clean), str(is_push),
                                resolve(cwd_here, hint), push_ref]))

sys.stdout.write("\n".join(lines))' 2>/dev/null)"

[ -n "$findings" ] || exit 0

cwd_hint="$(printf '%s\n' "$findings" | sed -n '1p')"
hits="$(printf '%s\n' "$findings" | sed -n '2,$p' | grep -v '^$')"

# Nothing destructive in the payload.
[ -n "$hits" ] || exit 0

# Resolve the work tree a destructive command will actually run in (#102). The
# hook process itself is launched from the primary checkout (settings.json
# invokes it via ${CLAUDE_PROJECT_DIR}), so the hook's own $PWD is NOT the tree
# at risk when Claude Code is working inside a `git worktree`. Try, in order:
# the directory that invocation resolved to (its own `git -C` / a preceding
# `cd`), the payload cwd, then the hook's own $PWD as a last resort -- so a
# payload without `cwd` degrades to the previous behaviour, not to "allow".
resolve_tree() {
  local hint="$1" candidate probe top
  for candidate in "$hint" "$cwd_hint" "$PWD"; do
    [ -n "$candidate" ] || continue
    case "$candidate" in
      /*) probe="$candidate" ;;
      -*) continue ;;
      *)  probe="${cwd_hint:-$PWD}/$candidate" ;;   # a relative hint is relative to cwd
    esac
    top="$(git -C "$probe" rev-parse --show-toplevel 2>/dev/null)" || continue
    [ -n "$top" ] || continue
    printf '%s' "$top"
    return 0
  done
  return 1
}

while IFS="$(printf '\t')" read -r is_clean is_push dir_hint push_ref; do
  target_tree="$(resolve_tree "$dir_hint")" || continue
  # Only meaningful inside a git work tree.
  [ -n "$target_tree" ] || continue

  status="$(git -C "$target_tree" status --short 2>/dev/null)"
  tracked_dirty="$(printf '%s\n' "$status" | grep -vE '^\?\?' | grep -v '^$')"

  # What this command can destroy: tracked modifications for all; clean also
  # eats untracked.
  at_risk="$tracked_dirty"
  [ "$is_clean" = "1" ] && at_risk="$(printf '%s\n' "$status" | grep -v '^$')"

  if [ -n "$at_risk" ]; then
    # Block. Preservation = make the tree clean (stash -u / commit) -- that is
    # the robust signal. We deliberately do NOT treat "a stash exists" as
    # preserved: a stale, unrelated stash would silently defeat the guard.
    {
      echo "BLOCKED (git-preflight): destructive git command with unpreserved changes."
      echo "Tree inspected: $target_tree"
      echo "Preserve first - 'git stash -u' or commit to a WIP branch (cleans the tree) - then retry."
      echo "At-risk changes this command would destroy:"
      printf '%s\n' "$at_risk"
    } >&2
    exit 2
  fi

  # This tree is clean. A force-push is still destructive for a branch that
  # ANOTHER linked worktree has checked out with unpreserved changes on it, so
  # check those too -- that is the one cross-tree case the command can
  # genuinely destroy.
  [ "$is_push" = "1" ] || continue

  branch="${push_ref#+}"
  branch="${branch##*:}"
  branch="${branch#refs/heads/}"
  if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
    branch="$(git -C "$target_tree" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  fi
  [ -n "$branch" ] && [ "$branch" != "HEAD" ] || continue

  other_tree="$(git -C "$target_tree" worktree list --porcelain 2>/dev/null | awk -v want="refs/heads/$branch" -v self="$target_tree" '
    /^worktree / { path = substr($0, 10) }
    /^branch /   { if (substr($0, 8) == want && path != self) { print path; exit } }
  ')"
  [ -n "$other_tree" ] || continue

  other_dirty="$(git -C "$other_tree" status --short 2>/dev/null | grep -vE '^\?\?' | grep -v '^$')"
  [ -n "$other_dirty" ] || continue

  {
    echo "BLOCKED (git-preflight): force-push to '$branch', which another worktree has checked out with unpreserved changes."
    echo "Tree at risk: $other_tree (this tree, $target_tree, is clean)"
    echo "Preserve there first - 'git -C $other_tree stash -u' or commit - then retry."
    echo "At-risk changes:"
    printf '%s\n' "$other_dirty"
  } >&2
  exit 2
done <<<"$hits"

exit 0
