// @ts-check
import { defineConfig } from 'astro/config';
import remarkStripCitations from './src/lib/remark-strip-citations.mjs';
import remarkStripMissingEvidence from './src/lib/remark-strip-missing-evidence.mjs';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://suchitracancercare.org',
  base: '/',
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
