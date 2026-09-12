#!/usr/bin/env python3
"""
Fail if any git-tracked file contains a credential-shaped literal.

Why this exists (issue #127): two DeepSeek API keys sat in seven tracked eval
scripts and docs of this PUBLIC repo for months. Both were revoked, but the
pattern - "hardcode the key as a fallback" - is what leaks the *next* key.
This check runs in CI ("Build + config parity" job) and can be run locally:

    python3 scripts/check_no_secret_literals.py

It scans only files tracked by git (so node_modules, build output and local
worktrees are never scanned) and never prints a matched value - only the file,
line and pattern name.
"""
from __future__ import annotations

import re
import subprocess
import sys

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # OpenAI / DeepSeek style
    ("sk- api key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    # Google API key
    ("google api key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    # Google OAuth access token
    ("google oauth token", re.compile(r"\bya29\.[0-9A-Za-z_-]{20,}\b")),
    # Meta / WhatsApp Graph token
    ("meta graph token", re.compile(r"\bEAA[A-Za-z0-9]{40,}\b")),
    # GitHub tokens
    ("github token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("github fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{40,}\b")),
    # Slack
    ("slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    # Private keys
    ("private key block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    # Postgres URL with an inline password
    ("database url with password", re.compile(r"postgres(?:ql)?://[^:\s/]+:[^@\s]{6,}@")),
]

# Files that legitimately contain matching *shapes* (documentation of the
# patterns themselves). Keep this list short and explicit.
ALLOWLIST_FILES = {
    "scripts/check_no_secret_literals.py",
    # Redaction unit test: its fixtures are deliberately key-shaped fakes that
    # the report generator must scrub. Reviewed 2026-09-12.
    "eval/runner/report-generator.redaction.test.ts",
}

# A database URL is only a finding when the password is not an obvious
# placeholder (docs and .env.example legitimately show postgres://user:PASSWORD@).
DB_URL = re.compile(r"postgres(?:ql)?://([^:\s/]+):([^@\s]{6,})@")
PLACEHOLDER_PASSWORD = re.compile(
    r"(password|passw|\bpass\b|changeme|change_me|your|example|xxx|secret|placeholder|redacted|\$|<|\{)", re.I
)
COMMON_DEFAULT_PASSWORDS = {"postgres", "password", "localhost", "changeme", "admin", "root"}


def db_url_is_placeholder(line: str) -> bool:
    m = DB_URL.search(line)
    if not m:
        return True
    user, pw = m.group(1), m.group(2)
    return bool(PLACEHOLDER_PASSWORD.search(pw)) or pw == user or pw.lower() in COMMON_DEFAULT_PASSWORDS

# Binary-ish or generated content we never want to open.
SKIP_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".mp3", ".mp4", ".wav", ".zip", ".gz", ".lock")


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], check=True, capture_output=True).stdout
    return [p for p in out.decode("utf-8", "surrogateescape").split("\0") if p]


def main() -> int:
    hits: list[str] = []
    for path in tracked_files():
        if path in ALLOWLIST_FILES or path.endswith(SKIP_SUFFIXES):
            continue
        try:
            with open(path, "rb") as fh:
                data = fh.read()
        except (FileNotFoundError, IsADirectoryError):
            continue  # symlink to outside the tree, or deleted in the working copy
        if b"\0" in data[:4096]:
            continue  # binary
        text = data.decode("utf-8", "replace")
        for lineno, line in enumerate(text.splitlines(), 1):
            for name, pat in PATTERNS:
                if not pat.search(line):
                    continue
                if name == "database url with password" and db_url_is_placeholder(line):
                    continue
                hits.append(f"{path}:{lineno}: {name}")
    if hits:
        print("FAIL: credential-shaped literal(s) in tracked files (values not shown):")
        for h in hits:
            print("  " + h)
        print("\nFix: read the value from the environment or Secret Manager; see issue #127.")
        return 1
    print("OK: no credential-shaped literals in tracked files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
