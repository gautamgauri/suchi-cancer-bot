#!/usr/bin/env python3
"""Render the Instagram card images for the social calendar.

Reads every `card: { file: "<name>.jpg", text: "<words>" }` in
apps/api/src/modules/social/content/calendar.ts, plus GENERIC_CARD in
social.service.ts, and writes a 1080 x 1350 (4:5) sRGB JPEG for each into
apps/landing/public/social/cards/. The landing site serves them at
https://suchitracancercare.org/social/cards/<name>.jpg once it is deployed.

Instagram's content publishing API accepts JPEG only, 320 to 1440 pixels wide,
aspect ratio 4:5 to 1.91:1, at most 8 MB.

    python3 scripts/render-social-cards.py            # render all
    python3 scripts/render-social-cards.py --check    # fail if a card is missing or its text cannot fit

Needs Pillow and the DejaVu Sans fonts (fonts-dejavu on Debian and Ubuntu).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CALENDAR = REPO / "apps/api/src/modules/social/content/calendar.ts"
SERVICE = REPO / "apps/api/src/modules/social/social.service.ts"
OUT = REPO / "apps/landing/public/social/cards"

W, H = 1080, 1350
TEAL = (15, 118, 110)
LIGHT = (204, 251, 241)
WHITE = (255, 255, 255)
MARGIN = 96

CARD_RE = re.compile(r'file:\s*"([a-z0-9-]+\.jpg)",\s*text:\s*"([^"]+)"')
FONT_DIRS = [Path("/usr/share/fonts/truetype/dejavu"), Path("/usr/share/fonts/dejavu"), Path("/Library/Fonts")]


def cards() -> dict[str, str]:
    found: dict[str, str] = {}
    for src in (CALENDAR, SERVICE):
        for name, text in CARD_RE.findall(src.read_text(encoding="utf-8")):
            found[name] = text.replace("\\'", "'")
    return found


def font(name: str, size: int):
    from PIL import ImageFont

    for d in FONT_DIRS:
        p = d / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    raise SystemExit(f"Font {name} not found. Install the DejaVu fonts.")


def wrap(draw, text: str, f, width: int) -> list[str]:
    lines: list[str] = []
    for para in text.split("\n"):
        line = ""
        for word in para.split():
            trial = f"{line} {word}".strip()
            if draw.textlength(trial, font=f) <= width:
                line = trial
            else:
                lines.append(line)
                line = word
        lines.append(line)
    return lines


def layout(d, text: str):
    """The largest type size at which every line fits inside the margins.

    A long word such as a web address cannot be wrapped, so the size also
    comes down until the widest line fits. Raises if nothing fits at 44.
    """
    width = W - 2 * MARGIN
    size = 76
    while size >= 44:
        big = font("DejaVuSans-Bold.ttf", size)
        lines = wrap(d, text, big, width)
        line_h = int(size * 1.3)
        widest = max(d.textlength(line, font=big) for line in lines)
        if len(lines) * line_h <= H - 2 * MARGIN - 300 and widest <= width:
            return big, lines, line_h
        size -= 4
    raise SystemExit(f"Card text does not fit at the smallest size: {text}")


def render(name: str, text: str) -> None:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (W, H), TEAL)
    d = ImageDraw.Draw(img)
    small = font("DejaVuSans.ttf", 34)
    d.text((MARGIN, MARGIN), "Suchitra Cancer Care Foundation", font=small, fill=LIGHT)
    d.rectangle([MARGIN, MARGIN + 60, MARGIN + 120, MARGIN + 66], fill=LIGHT)

    big, lines, line_h = layout(d, text)
    y = (H - len(lines) * line_h) // 2
    for line in lines:
        d.text((MARGIN, y), line, font=big, fill=WHITE)
        y += line_h

    d.text((MARGIN, H - MARGIN - 40), "suchitracancercare.org", font=small, fill=LIGHT)
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / name, "JPEG", quality=88, optimize=True, progressive=False)


def main() -> int:
    wanted = cards()
    if "--check" in sys.argv:
        missing = [n for n in wanted if not (OUT / n).exists()]
        if missing:
            print("Missing social cards: " + ", ".join(missing))
            return 1
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            print("Pillow is not installed, so the layout was not checked")
        else:
            d = ImageDraw.Draw(Image.new("RGB", (W, H)))
            for text in wanted.values():
                layout(d, text)
        print(f"OK: {len(wanted)} social cards present")
        return 0
    for name, text in wanted.items():
        render(name, text)
        print(f"wrote {OUT / name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
