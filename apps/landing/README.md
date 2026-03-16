# SCCF Landing Site (`apps/landing`)

Astro static site for:

- SCCF homepage
- curated Onco Talks video library (`/watch/`)
- per-video pages (`/watch/:slug/`)

## Tech + Deployment

- Framework: Astro (`output: static`)
- Production host: GitHub Pages via `.github/workflows/deploy-landing.yml`
- Site URL configured in `astro.config.mjs`: `https://suchitracancercare.org`

## Local Development

```bash
cd apps/landing
npm install
npm run dev
```

Default local URL: `http://localhost:4321`

Build and preview:

```bash
npm run build
npm run preview
```

## Content Model

Video content is driven by `src/content/videos.json`.

Top-level sections:

- `videos`: each card/page entry
- `cancerTypes`: filter metadata
- `situations`: filter metadata
- `playlists`: grouping metadata

Each video entry should include at minimum:

- `youtubeId`
- `title`
- `slug` (must be unique)
- `cancerTypes` (array of IDs present in `cancerTypes`)
- `situations` (array of IDs present in `situations`)
- `featured` (boolean)

Optional fields used by templates:

- `speaker`
- `affiliation`
- `date`
- `duration`
- `takeaways`
- `whoIsThisFor`
- `questionsToAsk`

## Routing Notes

- Homepage: `src/pages/index.astro`
- Video listing: `src/pages/watch/index.astro`
- Video details: `src/pages/watch/[slug].astro`

`[slug].astro` uses `getStaticPaths()` over `videos.json`, so every `slug` must remain stable after publishing.

## Updating Video Content

1. Add/update entries in `src/content/videos.json`.
2. Ensure the `slug` is URL-safe and unique.
3. Verify `cancerTypes` and `situations` values reference existing IDs.
4. Run `npm run build` to catch broken JSON/routes.
5. Run `npm run dev` and validate:
   - filter behavior on `/watch/`
   - detail page rendering on `/watch/<slug>/`
   - YouTube embed playback

## Common Pitfalls

- Duplicate `slug` values can break static path generation.
- Invalid JSON formatting will fail the Astro build.
- Unknown `cancerTypes`/`situations` IDs produce missing filter labels.
- Very long titles can overflow cards on small screens; check the mobile layout.
