# SCCF mark — measured geometry

The arcs in `apps/landing/public/brand/sccf-mark.svg` are a redraw of the approved
SCCF logo, measured off the 2048×2048 master (`sccf-logo-drive.jpg`, SCCF Drive)
rather than eyeballed. Nothing here is a new design decision.

## Sampled colours

| role | hex | how |
|---|---|---|
| gold (arcs, wordmark) | `#B49167` | median **and** mean of the interior 50 % of all three strokes — identical to the byte on each ring |
| deep teal (ground) | `#133133` | median and mean of the background outside r = 560 px |

## Measured geometry (master pixels)

- concentric centre: **(1156.0, 780.0)**, found by maximising the sharpness of the
  gold-pixel radius histogram (coarse-to-fine search down to ⅛ px)
- stroke width: **65.0 px** on every ring (radial cut at 135°)
- ring mid-radii: **165.45 / 297.70 / 429.90 px** — spacing 132.25 px, i.e. exactly
  2 × stroke; inter-ring gap 67.2 px ≈ stroke
- sweeps: **270° / 180° / 90°**, every arc starting at 90° (6 o'clock) and running
  clockwise, so the opening widens outward to the right
- ends are radial butt cuts — no round caps
- drawn bbox 662 × 794 px = **10w × 12w**, which confirms the construction

## Normalised system used in the SVG

Stroke `w = 10`, radii `2.5w / 4.5w / 6.5w` = 25 / 45 / 65, arc centre (90, 60) in a
square `viewBox="0 0 140 140"`. Clearspace is 2w left/right and 1w top/bottom of the
drawn bbox. Rebuild vs master: **99.49 %** of lit pixels overlap
(`renders/sccf-mark-vs-original.png`, third panel — yellow = agreement).

## Files

| file | use |
|---|---|
| `apps/landing/public/brand/sccf-mark.svg` | gold on transparent — header, footer |
| `apps/landing/public/brand/sccf-mark-mono.svg` | `currentColor`, for CSS-coloured contexts |
| `apps/landing/public/favicon.svg` | arcs on a filled teal rounded square |
| `apps/landing/public/favicon-16.png` … `icon-512.png` | raster fallbacks |
| `apps/landing/public/og-image.png` | 1200×630 social card |

The wordmark and the script tagline are **not** vectorised here — the site sets
"Suchitra Cancer Care" as live text in `Header.astro` / `Footer.astro`.
