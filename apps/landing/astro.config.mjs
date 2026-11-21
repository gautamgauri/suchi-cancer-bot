// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkStripCitations from './src/lib/remark-strip-citations.mjs';
import remarkStripMissingEvidence from './src/lib/remark-strip-missing-evidence.mjs';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://suchitracancercare.org',
  base: '/',
  // Custom domain from public/CNAME, served at the root by GitHub Pages.
  // The sitemap and canonical URLs are built from `site`, so keep them in step.
  integrations: [sitemap()],
  trailingSlash: 'always',
  build: {
    assets: '_assets'
  },
  markdown: {
    // Strip CGP internal markers from public render. Source-of-truth data
    // still lives in frontmatter (provenance.source_chunks, provenance.gaps).
    remarkPlugins: [
      remarkStripCitations,         // [citation:doc_id:chunk_id]
      remarkStripMissingEvidence,   // {{MISSING_EVIDENCE: ...}}
    ]
  }
});
