// @ts-check
import { defineConfig } from 'astro/config';
import remarkStripCitations from './src/lib/remark-strip-citations.mjs';

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
    // Strip [citation:doc_id:chunk_id] markers from rendered article bodies.
    // Citation data still lives in frontmatter.provenance.source_chunks and
    // is rendered in the Sources <details> block by the dynamic route.
    remarkPlugins: [remarkStripCitations]
  }
});
