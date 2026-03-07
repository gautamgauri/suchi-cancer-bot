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
  // Fellowship/personal sections
  engagement: {
    corpus: [CORPUS.PERSONAL, CORPUS.DIKSHA_INTERNAL],
  },
  career: {
    corpus: [CORPUS.PERSONAL, CORPUS.DIKSHA_INTERNAL],
  },
  expertise: {
    corpus: [CORPUS.PERSONAL, CORPUS.THEORY_FRAMEWORKS],
  },
  focus: {
    corpus: [CORPUS.PERSONAL, CORPUS.THEORY_FRAMEWORKS],
  },
};

/**
 * Returns the corpus route for a given section name.
 * Falls back to searching all corpora if no match.
 * When orgId is "sccf", swaps DIKSHA_INTERNAL for SCCF_INTERNAL.
 */
export function getCorpusRoute(sectionName: string, orgId?: string, docTypeCategory?: string): CorpusRoute {
  const key = sectionName.toLowerCase().replace(/[^a-z]/g, "");
  let route: CorpusRoute = { corpus: [] };
  for (const [routeKey, r] of Object.entries(SECTION_ROUTES)) {
    if (key.includes(routeKey)) { route = r; break; }
  }

  // Fellowship/tech_accelerator: ensure personal corpus is always included
  const isFellowshipTrack = docTypeCategory === "fellowship" || docTypeCategory === "tech_accelerator";
  if (isFellowshipTrack) {
    if (route.corpus.length === 0) {
      // No route matched — default to personal + diksha_internal
      route = { corpus: [CORPUS.PERSONAL, CORPUS.DIKSHA_INTERNAL] };
    } else if (!route.corpus.includes(CORPUS.PERSONAL)) {
      // Route matched but missing personal — prepend it
      route = { ...route, corpus: [CORPUS.PERSONAL, ...route.corpus] };
    }
  }

  if (orgId === "sccf" && route.corpus.length > 0) {
    return {
      ...route,
      corpus: route.corpus.map((c) =>
        c === CORPUS.DIKSHA_INTERNAL ? CORPUS.SCCF_INTERNAL : c,
      ),
    };
  }
  return route;
}
