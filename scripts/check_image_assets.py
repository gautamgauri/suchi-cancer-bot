#!/usr/bin/env python3
"""Fail if anything shipped with an image extension is not actually that image.

Added after two files in apps/landing/public/assets/ turned out to be saved
Facebook login pages with a .jpg extension - the browser just renders a broken
image, and nothing in the build complains.  This checks magic bytes (and, for
SVG, that the file really parses as an <svg> root), so a truncated download or a
saved HTML error page is caught before it reaches the site.

Usage:  python3 scripts/check_image_assets.py [path ...]
Exit 0 when every checked file matches its extension, 1 otherwise.
"""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET

DEFAULT_ROOTS = [
    os.path.join("apps", "landing", "public"),
    os.path.join("apps", "web", "public"),
    os.path.join("docs", "brand"),
]

SKIP_DIRS = {"node_modules", ".git", "dist", ".astro", "__pycache__"}

# extension -> (human name, [magic byte prefixes])
MAGIC: dict[str, tuple[str, list[bytes]]] = {
    ".png": ("PNG", [b"\x89PNG\r\n\x1a\n"]),
    ".jpg": ("JPEG", [b"\xff\xd8\xff"]),
    ".jpeg": ("JPEG", [b"\xff\xd8\xff"]),
    ".gif": ("GIF", [b"GIF87a", b"GIF89a"]),
    ".webp": ("WebP", [b"RIFF"]),
    ".ico": ("ICO", [b"\x00\x00\x01\x00"]),
    ".bmp": ("BMP", [b"BM"]),
    ".avif": ("AVIF", []),          # checked via the ftyp box below
}


def check_file(path: str) -> str | None:
    """Return an error string, or None when the file is fine."""
    ext = os.path.splitext(path)[1].lower()
    try:
        with open(path, "rb") as fh:
            head = fh.read(4096)
    except OSError as exc:
        return f"unreadable ({exc})"

    if not head:
        return "empty file"

    if ext == ".svg":
        try:
            ET.parse(path)
        except ET.ParseError as exc:
            return f"not parseable XML ({exc})"
        root = ET.parse(path).getroot().tag
        if not root.endswith("svg"):
            return f"XML root is <{root}>, not <svg>"
        return None

    if ext == ".webp":
        if not (head.startswith(b"RIFF") and head[8:12] == b"WEBP"):
            return "not a WebP (RIFF/WEBP header missing)"
        return None

    if ext == ".avif":
        if head[4:8] != b"ftyp":
            return "not an AVIF (no ftyp box)"
        return None

    name, prefixes = MAGIC[ext]
    if not any(head.startswith(p) for p in prefixes):
        sniff = head[:16]
        if head.lstrip()[:1] == b"<":
            sniff = b"HTML/XML document"
        return f"not a {name} (starts with {sniff!r})"
    return None


def walk(roots: list[str]) -> list[str]:
    found = []
    for root in roots:
        if os.path.isfile(root):
            found.append(root)
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                if os.path.splitext(fn)[1].lower() in set(MAGIC) | {".svg"}:
                    found.append(os.path.join(dirpath, fn))
    return sorted(found)


def main(argv: list[str]) -> int:
    repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    os.chdir(repo)
    roots = argv[1:] or [r for r in DEFAULT_ROOTS if os.path.isdir(r)]
    files = walk(roots)
    if not files:
        print("no image assets found under:", ", ".join(roots))
        return 0

    failures = []
    for path in files:
        err = check_file(path)
        if err:
            failures.append((path, err))
            print(f"FAIL  {path}: {err}")
        else:
            print(f"ok    {path}")

    print(f"\n{len(files) - len(failures)}/{len(files)} image assets valid")
    if failures:
        print("\nCorrupt assets (the file extension lies about the contents):")
        for path, err in failures:
            print(f"  - {path}: {err}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
