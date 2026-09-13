#!/usr/bin/env python3
"""Fail if any tracked image-named file under a public asset dir is not an image.

Why this exists (issue #140): apps/landing/public/assets/founders_photo.jpg and
logo.jpg were Facebook login/interstitial HTML pages saved under a .jpg name.
The web server served them as image/jpeg (by extension), every browser failed
to decode them, and the founders photo on the public About page was broken for
weeks. A file whose extension says "image" but whose bytes say "HTML" is exactly
the class of bug a magic-byte check catches in one line.

This check runs in CI (deploy-api.yml "Build + config parity" job and the
landing build) and can be run locally:

    python3 scripts/check_image_assets.py            # check tracked assets
    python3 scripts/check_image_assets.py --self-test # exercise the detectors

It scans only files tracked by git under the directories in SCAN_DIRS (so
node_modules and build output are never scanned), reads at most the first few
KiB of each file, and exits non-zero listing every offender.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Directories whose tracked image-named files must be real images.
SCAN_DIRS = ("apps/landing/public", "apps/web/public")

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".avif", ".bmp",
}

# How many leading bytes to read. SVGs may open with a BOM, XML prolog, DOCTYPE
# and comments before the <svg> root, so we look a little deeper for them.
HEAD_BYTES = 4096

HTML_MARKERS = (b"<html", b"<!doctype html", b"<head", b"<body", b"<script")


def sniff(ext: str, head: bytes) -> str | None:
    """Return None if `head` looks like an image of type `ext`, else a reason."""
    ext = ext.lower()
    if not head:
        return "empty file"

    # Any image-named file that opens like an HTML document is wrong regardless
    # of extension. This is the #140 failure shape.
    lowered = head[:512].lstrip().lower()
    if lowered.startswith(b"<!doctype html") or lowered.startswith(b"<html"):
        return "HTML document saved with an image extension"

    if ext in (".jpg", ".jpeg"):
        if head.startswith(b"\xff\xd8\xff"):
            return None
        return "not a JPEG (expected FF D8 FF)"

    if ext == ".png":
        if head.startswith(b"\x89PNG\r\n\x1a\n"):
            return None
        return "not a PNG (expected 89 50 4E 47 0D 0A 1A 0A)"

    if ext == ".gif":
        if head.startswith(b"GIF87a") or head.startswith(b"GIF89a"):
            return None
        return "not a GIF (expected GIF87a/GIF89a)"

    if ext == ".webp":
        if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
            return None
        return "not a WebP (expected RIFF....WEBP)"

    if ext == ".avif":
        # ISO BMFF: 4-byte size, then 'ftyp', then a brand such as 'avif'/'avis'.
        if head[4:8] == b"ftyp" and head[8:12] in (b"avif", b"avis"):
            return None
        return "not an AVIF (expected ....ftypavif)"

    if ext == ".bmp":
        if head.startswith(b"BM"):
            return None
        return "not a BMP (expected BM)"

    if ext == ".ico":
        # Classic ICO directory header, or a PNG (browsers accept PNG favicons
        # named .ico and Astro's default favicon.ico is one).
        if head.startswith(b"\x00\x00\x01\x00") or head.startswith(b"\x89PNG\r\n\x1a\n"):
            return None
        return "not an ICO (expected 00 00 01 00 or PNG)"

    if ext == ".svg":
        text = head
        if text.startswith(b"\xef\xbb\xbf"):  # UTF-8 BOM
            text = text[3:]
        stripped = text.lstrip()
        if not (stripped.startswith(b"<svg") or stripped.startswith(b"<?xml")):
            return "SVG must start with <svg or <?xml"
        low = text.lower()
        if any(marker in low for marker in HTML_MARKERS):
            return "SVG contains HTML markup"
        if b"<svg" not in low:
            return "SVG has an XML prolog but no <svg root in the first %d bytes" % HEAD_BYTES
        return None

    return f"unknown image extension {ext}"


def tracked_image_files(repo_root: Path) -> list[Path]:
    out = subprocess.run(
        ["git", "-C", str(repo_root), "ls-files", "-z", "--", *SCAN_DIRS],
        check=True,
        capture_output=True,
    ).stdout
    files = []
    for raw in out.split(b"\0"):
        if not raw:
            continue
        rel = raw.decode("utf-8", "surrogateescape")
        if Path(rel).suffix.lower() in IMAGE_EXTENSIONS:
            files.append(Path(rel))
    return sorted(files)


def check_repo(repo_root: Path) -> int:
    files = tracked_image_files(repo_root)
    offenders: list[tuple[Path, str]] = []
    for rel in files:
        path = repo_root / rel
        if not path.is_file():
            # Tracked in the index but deleted in the working tree (e.g. a
            # pending `git rm`). Nothing to ship, nothing to check.
            continue
        with path.open("rb") as fh:
            head = fh.read(HEAD_BYTES)
        reason = sniff(path.suffix, head)
        if reason is not None:
            offenders.append((rel, reason))

    print(f"check_image_assets: {len(files)} tracked image file(s) under {', '.join(SCAN_DIRS)}")
    if offenders:
        print(f"FAIL: {len(offenders)} file(s) are not the image their extension claims:")
        for rel, reason in offenders:
            size = (repo_root / rel).stat().st_size
            print(f"  {rel.as_posix()}  ({size} bytes): {reason}")
        print("Replace each with the real image asset, or delete it. See issue #140.")
        return 1
    print("OK: every tracked image-named file has valid image magic bytes")
    return 0


def self_test() -> int:
    """Exercise sniff() against known-good and known-bad byte heads, and run the
    full tracked-file path against a throwaway git repo containing an
    HTML-as-.jpg file to prove the check fails on the #140 failure shape."""
    good = [
        (".jpg", b"\xff\xd8\xff\xe0\x00\x10JFIF"),
        (".jpeg", b"\xff\xd8\xff\xdb"),
        (".png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
        (".gif", b"GIF89a\x01\x00"),
        (".webp", b"RIFF\x24\x00\x00\x00WEBPVP8 "),
        (".ico", b"\x00\x00\x01\x00\x01\x00"),
        (".ico", b"\x89PNG\r\n\x1a\n"),
        (".avif", b"\x00\x00\x00\x1cftypavif"),
        (".bmp", b"BM\x36\x00"),
        (".svg", b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        (".svg", b'<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'),
        (".svg", b'\xef\xbb\xbf<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ]
    bad = [
        (".jpg", b'<!DOCTYPE html>\n<html lang="nl" id="facebook">'),
        (".jpg", b"\x89PNG\r\n\x1a\n"),  # PNG bytes under a .jpg name
        (".png", b"\xff\xd8\xff\xe0"),
        (".gif", b"GIF90a"),
        (".webp", b"RIFF\x24\x00\x00\x00WAVEfmt "),
        (".ico", b"MZ\x90\x00"),
        (".svg", b"<html><body><svg/></body></html>"),
        (".svg", b'<?xml version="1.0"?><html><svg/></html>'),
        (".svg", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        (".svg", b"just text"),
        (".svg", b"<?xml version='1.0'?><note/>"),
        (".png", b""),
    ]
    failures = 0
    for ext, head in good:
        reason = sniff(ext, head)
        if reason is not None:
            failures += 1
            print(f"self-test FAIL: expected {ext} head {head[:16]!r} to pass, got: {reason}")
    for ext, head in bad:
        reason = sniff(ext, head)
        if reason is None:
            failures += 1
            print(f"self-test FAIL: expected {ext} head {head[:16]!r} to be rejected")

    # End-to-end: a throwaway repo with one real PNG and one HTML-as-jpg.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
        subprocess.run(["git", "init", "-q", str(root)], check=True, env=env)
        assets = root / SCAN_DIRS[0] / "assets"
        assets.mkdir(parents=True)
        (assets / "ok.png").write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
        (assets / "fake.jpg").write_bytes(b'<!DOCTYPE html>\n<html lang="nl" id="facebook"></html>')
        (root / SCAN_DIRS[0] / "notes.txt").write_text("not an image, not checked\n")
        subprocess.run(["git", "-C", str(root), "add", "-A"], check=True, env=env)
        print("--- self-test: expecting a FAIL from the throwaway repo below ---")
        rc = check_repo(root)
        print("--- end throwaway repo output ---")
        if rc == 0:
            failures += 1
            print("self-test FAIL: HTML-as-.jpg in a tracked asset dir was not detected")
        (assets / "fake.jpg").unlink()
        subprocess.run(["git", "-C", str(root), "add", "-A"], check=True, env=env)
        if check_repo(root) != 0:
            failures += 1
            print("self-test FAIL: clean throwaway repo did not pass")

    if failures:
        print(f"self-test: {failures} failure(s)")
        return 1
    print(f"self-test: OK ({len(good)} good heads accepted, {len(bad)} bad heads rejected, "
          "end-to-end HTML-as-.jpg detected)")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    return check_repo(REPO_ROOT)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
