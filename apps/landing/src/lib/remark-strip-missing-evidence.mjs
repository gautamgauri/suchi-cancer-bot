// Strip {{MISSING_EVIDENCE: <description>}} placeholders from rendered article body.
//
// These markers are an internal CGP gap-flag — they tell the reviewer pipeline
// (Module 6) and human QA (Module 8) that a section needs additional evidence
// before publish. They MUST NOT reach public readers.
//
// The structured form lives in frontmatter.provenance.gaps[]; the inline marker
// is removed here so the published page reads cleanly. If the surrounding
// sentence relies on the placeholder, the article author should either omit the
// sentence entirely OR rewrite it without speculative content.

import { visit } from 'unist-util-visit';

// Match {{MISSING_EVIDENCE: anything that isn't }}}}.  Tolerates whitespace,
// newlines, and any inner punctuation. Greedy match would risk eating across
// multiple placeholders; we use lazy + bounded.
const MISSING_RE = /\s*\{\{MISSING_EVIDENCE:\s*[^}]*\}\}\s*/g;

export default function remarkStripMissingEvidence() {
  return (tree) => {
    visit(tree, 'text', (node) => {
      if (MISSING_RE.test(node.value)) {
        node.value = node.value.replace(MISSING_RE, ' ');
        // Collapse stray double-spaces and trim leading/trailing whitespace
        node.value = node.value.replace(/[ \t]{2,}/g, ' ').trim();
      }
    });
  };
}
