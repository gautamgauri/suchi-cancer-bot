// Strip [citation:doc_id:chunk_id] markers from rendered article body.
//
// Per project design principle: citations are an audit trail (rendered in
// the Sources <details> block at the bottom of each article via frontmatter),
// not user-facing UI. The markers must not clutter the public reading view.
//
// Implementation: visit text nodes, regex-replace the marker with empty
// string, collapse the resulting double-spaces / leading-spaces. We DO NOT
// remove the underlying citation data — provenance.source_chunks lives in
// frontmatter and the dynamic route renders the deduplicated list.

import { visit } from 'unist-util-visit';

const CITATION_RE = /\s*\[citation:[^\]]+\]/g;

export default function remarkStripCitations() {
  return (tree) => {
    visit(tree, 'text', (node) => {
      if (CITATION_RE.test(node.value)) {
        node.value = node.value.replace(CITATION_RE, '');
        // Collapse stray double-spaces left behind, preserve leading whitespace
        node.value = node.value.replace(/[ \t]{2,}/g, ' ');
      }
    });
  };
}
