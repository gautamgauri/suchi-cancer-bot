/**
 * Deterministic corpus routing for proposal sections.
 *
 * Maps section names to the corpus + docType filters that should
 * be applied when retrieving evidence for that section.
 */

import { CORPUS } from "../../evidence_ingest/corpus.constants";

export interface CorpusRoute {
  corpus: string[];
  docTypes?: string[];
  limit?: number;
}

const SECTION_ROUTES: Record<string, CorpusRoute> = {
  budget: {
    corpus: [CORPUS.DIKSHA_INTERNAL, CORPUS.DONOR_FUNDER],
    docTypes: ["budget", "report", "proposal"],
  },
  background: {
    corpus: [CORPUS.DIKSHA_INTERNAL, CORPUS.EXTERNAL_EVIDENCE],
    docTypes: ["report", "profile", "misc"],
  },
  objectives: {
    corpus: [CORPUS.DIKSHA_INTERNAL, CORPUS.THEORY_FRAMEWORKS],
    docTypes: ["proposal", "report", "concept_note"],
  },
  activities: {
    corpus: [CORPUS.DIKSHA_INTERNAL, CORPUS.THEORY_FRAMEWORKS],
  },
  monitoring: {
    corpus: [CORPUS.DIKSHA_INTERNAL, CORPUS.THEORY_FRAMEWORKS],
    docTypes: ["report", "proposal"],
  },
  team: {
    corpus: [CORPUS.DIKSHA_INTERNAL],
    docTypes: ["profile", "report", "proposal"],
  },
  beneficiaries: {
    corpus: [CORPUS.DIKSHA_INTERNAL, CORPUS.EXTERNAL_EVIDENCE],
  },
  outcomes: {
    corpus: [CORPUS.THEORY_FRAMEWORKS, CORPUS.DIKSHA_INTERNAL],
  },
  sustainability: {
    corpus: [CORPUS.DIKSHA_INTERNAL, CORPUS.DONOR_FUNDER],
  },
};

/**
 * Returns the corpus route for a given section name.
 * Falls back to searching all corpora if no match.
 */
export function getCorpusRoute(sectionName: string): CorpusRoute {
  const key = sectionName.toLowerCase().replace(/[^a-z]/g, "");
  for (const [routeKey, route] of Object.entries(SECTION_ROUTES)) {
    if (key.includes(routeKey)) return route;
  }
  return { corpus: [] };
}
