#!/usr/bin/env python3
"""Build the SCCF brand assets for the landing site from measured geometry.

Everything here is derived from the approved SCCF master logo (2048x2048 JPEG
from the SCCF Drive folder), measured rather than eyeballed:

    concentric centre  (1156.0, 780.0) px
    stroke width       65.0 px on every ring
    ring mid-radii     165.45 / 297.70 / 429.90 px   (spacing 132.25 = 2 x stroke)
    sweeps             270 / 180 / 90 deg, each starting at 90 deg (6 o'clock),
                       running clockwise, butt (radial) ends
    gold               #B49167      teal #133133

which normalises exactly to radii 2.5w / 4.5w / 6.5w.  See docs/brand/README.md.

Usage:  python3 scripts/brand/build_brand_assets.py
Requires: cairosvg, pillow.
"""
from __future__ import annotations

import math
import os

GOLD = "#B49167"
TEAL = "#133133"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PUBLIC = os.path.join(ROOT, "apps", "landing", "public")
BRAND = os.path.join(PUBLIC, "brand")


def f(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _pt(cx: float, cy: float, r: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def _arc(cx: float, cy: float, r: float, a1: float, sweep: float) -> str:
    """Clockwise (screen-space) arc of `sweep` degrees starting at angle `a1`."""
    x1, y1 = _pt(cx, cy, r, a1)
    x2, y2 = _pt(cx, cy, r, a1 + sweep)
    large = 1 if sweep > 180 else 0
    return f"M {f(x1)} {f(y1)} A {f(r)} {f(r)} 0 {large} 1 {f(x2)} {f(y2)}"


# ring (radius in stroke-widths, sweep in degrees), outermost last
RINGS = ((2.5, 270.0), (4.5, 180.0), (6.5, 90.0))


def mark_paths(cx: float, cy: float, w: float, rings=RINGS) -> list[str]:
    return [_arc(cx, cy, r * w, 90.0, sweep) for r, sweep in rings]


def bbox_units(rings=RINGS, stroke_units: float = 1.0) -> tuple[float, float, float, float]:
    """Drawn bbox in stroke-widths, relative to the arc centre: x0, y0, x1, y1."""
    h = stroke_units / 2.0
    xs, ys = [], []
    for r, sweep in rings:
        # sample the swept angles plus the cardinal points inside the sweep
        angles = [90.0, 90.0 + sweep] + [a for a in (180.0, 270.0, 360.0) if a < 90.0 + sweep]
        for a in angles:
            x, y = _pt(0.0, 0.0, r, a)
            xs += [x - h, x + h]
            ys += [y - h, y + h]
    return min(xs), min(ys), max(xs), max(ys)


def mark_svg(colour: str, size: int = 140, w: float = 10.0,
             title: str = "Suchitra Cancer Care Foundation") -> str:
    """The mark alone on a transparent ground, centred in a square viewBox."""
    x0, y0, x1, y1 = bbox_units()
    cx = size / 2.0 - (x0 + x1) / 2.0 * w
    cy = size / 2.0 - (y0 + y1) / 2.0 * w
    paths = "\n    ".join(f'<path d="{d}" />' for d in mark_paths(cx, cy, w))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'role="img" aria-label="{title}">\n'
        f"  <title>{title}</title>\n"
        f'  <g fill="none" stroke="{colour}" stroke-width="{f(w)}" stroke-linecap="butt">\n'
        f"    {paths}\n"
        f"  </g>\n</svg>\n"
    )


def favicon_svg(size: int = 64, pad: float = 4.0, rings=RINGS,
                stroke_ratio: float = 1.0) -> str:
    """Arcs on a filled teal rounded square, so the tab icon reads on light and dark.

    `stroke_ratio` > 1 thickens the strokes without moving the ring radii — an
    optical correction for very small raster sizes.
    """
    x0, y0, x1, y1 = bbox_units(rings, stroke_ratio)
    w = (size - 2 * pad) / max(x1 - x0, y1 - y0)
    cx = size / 2.0 - (x0 + x1) / 2.0 * w
    cy = size / 2.0 - (y0 + y1) / 2.0 * w
    paths = "\n    ".join(f'<path d="{d}" />' for d in mark_paths(cx, cy, w, rings))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'role="img" aria-label="Suchitra Cancer Care Foundation">\n'
        f"  <title>Suchitra Cancer Care Foundation</title>\n"
        f'  <rect width="{size}" height="{size}" rx="{f(size * 0.1875)}" fill="{TEAL}" />\n'
        f'  <g fill="none" stroke="{GOLD}" stroke-width="{f(w * stroke_ratio)}" '
        f'stroke-linecap="butt">\n'
        f"    {paths}\n"
        f"  </g>\n</svg>\n"
    )


# At 16 px three concentric strokes plus their two gaps cannot resolve (the mark
# is 12 stroke-widths tall, so each stroke would land under 1.4 px).  The 16 px
# raster therefore drops the outer quarter-arc and keeps the two inner rings.
SMALL_RINGS = ((2.5, 270.0), (4.5, 180.0))


def og_svg(width: int = 1200, height: int = 630) -> str:
    """Social card: teal ground, gold mark, no text (the wordmark is a licensed face)."""
    w = 26.0
    x0, y0, x1, y1 = bbox_units()
    cx = width / 2.0 - (x0 + x1) / 2.0 * w
    cy = height / 2.0 - (y0 + y1) / 2.0 * w
    paths = "\n    ".join(f'<path d="{d}" />' for d in mark_paths(cx, cy, w))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">\n'
        f'  <rect width="{width}" height="{height}" fill="{TEAL}" />\n'
        f'  <g fill="none" stroke="{GOLD}" stroke-width="{f(w)}" stroke-linecap="butt">\n'
        f"    {paths}\n"
        f"  </g>\n</svg>\n"
    )


def main() -> None:
    import cairosvg

    os.makedirs(BRAND, exist_ok=True)

    def write(path: str, text: str) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("wrote", os.path.relpath(path, ROOT))

    write(os.path.join(BRAND, "sccf-mark.svg"), mark_svg(GOLD))
    write(os.path.join(BRAND, "sccf-mark-mono.svg"), mark_svg("currentColor"))

    full = favicon_svg()
    small = favicon_svg(pad=3.0, rings=SMALL_RINGS, stroke_ratio=1.1)
    write(os.path.join(PUBLIC, "favicon.svg"), full)

    def png(svg: str, out: str, px: int) -> None:
        cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(PUBLIC, out),
                         output_width=px, output_height=px)
        print("wrote", out, f"({px}px)")

    png(small, "favicon-16.png", 16)          # optically reduced: two rings
    png(full, "favicon-32.png", 32)
    png(full, "apple-touch-icon.png", 180)
    png(full, "icon-192.png", 192)
    png(full, "icon-512.png", 512)

    cairosvg.svg2png(bytestring=og_svg().encode(),
                     write_to=os.path.join(PUBLIC, "og-image.png"),
                     output_width=1200, output_height=630)
    print("wrote og-image.png (1200x630)")

    # /favicon.ico is still requested by older browsers and by crawlers that
    # ignore the <link> tags, so it has to carry the real mark too.
    import io

    from PIL import Image

    def raster(svg: str, px: int) -> Image.Image:
        buf = io.BytesIO()
        cairosvg.svg2png(bytestring=svg.encode(), write_to=buf,
                         output_width=px, output_height=px)
        return Image.open(io.BytesIO(buf.getvalue())).convert("RGBA")

    # Pillow's ICO writer only ever downsamples the base frame, so the base has
    # to be the largest one; the 16 px frame is supplied separately so it gets
    # the optically reduced two-ring drawing rather than a blurred downscale.
    ico = os.path.join(PUBLIC, "favicon.ico")
    raster(full, 48).save(ico, format="ICO", sizes=[(48, 48), (32, 32), (16, 16)],
                          append_images=[raster(full, 32), raster(small, 16)])
    print("wrote favicon.ico (16/32/48)")


if __name__ == "__main__":
    main()
