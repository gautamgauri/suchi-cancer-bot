/**
 * Query expansion with domain-specific synonyms for funding/education sector retrieval.
 *
 * Zero LLM cost — pure dictionary-based expansion that augments queries with
 * alternative terms for concepts that appear frequently in grant proposals.
 *
 * Strategy: Append 1-3 synonym terms to each query so the embedding model
 * captures nearby concepts. Does NOT replace original terms.
 */
import { Injectable, Logger } from "@nestjs/common";

/**
 * Domain synonym map: canonical term → alternative phrasings.
 * Kept intentionally compact — only high-value expansions that
 * improve retrieval without diluting query intent.
 */
const DOMAIN_SYNONYMS: Record<string, string[]> = {
  // --- Fundraising & grant terminology ---
  "budget": ["cost estimate", "expenditure plan", "financial projection"],
  "grant": ["funding", "award", "financial support"],
  "funder": ["donor", "grant-maker", "funding agency"],
  "proposal": ["application", "concept note", "funding request"],

  // --- M&E and results ---
  "outcomes": ["impact indicators", "results", "M&E results"],
  "results": ["outcomes", "impact", "achievements"],
  "monitoring": ["M&E", "evaluation", "tracking", "assessment"],
  "indicators": ["metrics", "KPIs", "measurement criteria"],
  "baseline": ["pre-intervention", "starting point", "initial assessment"],
  "endline": ["post-intervention", "final assessment", "impact evaluation"],

  // --- Beneficiary / target group ---
  "beneficiaries": ["target population", "participants", "stakeholders", "learners"],
  "children": ["students", "learners", "youth", "young people"],
  "adolescent girls": ["girls", "young women", "female youth"],

  // --- Program / activity terminology ---
  "activities": ["interventions", "sessions", "programming"],
  "curriculum": ["syllabus", "learning modules", "course content"],
  "training": ["capacity building", "professional development", "skill building"],
  "life skills": ["social-emotional learning", "SEL", "soft skills", "21st century skills"],
  "sports": ["physical education", "athletics", "games", "play-based learning"],
  "digital literacy": ["ICT skills", "computer education", "technology training"],

  // --- Diksha-specific programs ---
  "KHEL": ["Knowledge Hub for Education and Learning", "KHEL center", "learning center"],
  "Empowering Futures": ["EF program", "girls empowerment", "adolescent program"],
  "Fellow Teacher": ["teaching fellow", "teacher mentor", "classroom facilitator"],
  "Bal Sansad": ["Children's Parliament", "civic engagement", "student governance"],
  "SEE Learning": ["social emotional ethical learning", "Dalai Lama Trust curriculum", "SEL curriculum"],

  // --- Indian development sector ---
  "CSR": ["corporate social responsibility", "CSR-1", "Companies Act Section 135"],
  "FCRA": ["Foreign Contribution Regulation", "foreign funding", "FCRA registration"],
  "NEP 2020": ["National Education Policy", "New Education Policy", "education reform"],
  "RTE": ["Right to Education", "RTE Act", "universal education"],
  "FLN": ["Foundational Literacy and Numeracy", "NIPUN Bharat", "early grade learning"],

  // --- Sustainability & scale ---
  "sustainability": ["exit strategy", "long-term viability", "continuity plan"],
  "scale": ["expansion", "replication", "growth", "scaling up"],
  "stakeholder": ["community member", "parent", "school administrator", "partner"],

  // --- Geography ---
  "Bihar": ["Patna", "Samastipur", "Bihta"],
  "Patna": ["Rukanpura", "Bihar capital"],

  // --- Fellowship / personal narrative ---
  "fellowship": ["scholarship", "residency", "accelerator", "cohort"],
  "Cambridge": ["University of Cambridge", "MPhil Education", "Capabilities Approach"],
  "narrative": ["personal story", "journey", "motivation", "founding story"],
  "leadership": ["founder", "executive director", "co-founder", "growth trajectory"],
};

/**
 * Section-specific expansion priorities: which synonym groups matter most per section.
 */
const SECTION_EXPANSION_PRIORITY: Record<string, string[]> = {
  budget: ["budget", "grant", "training", "activities"],
  objectives: ["outcomes", "indicators", "baseline", "beneficiaries"],
  monitoring: ["monitoring", "indicators", "baseline", "endline"],
  results: ["results", "outcomes", "indicators", "beneficiaries"],
  need: ["children", "Bihar", "NEP 2020", "RTE", "FLN"],
  activities: ["activities", "curriculum", "sports", "digital literacy", "life skills", "KHEL"],
  beneficiaries: ["beneficiaries", "children", "adolescent girls", "Bihar"],
  team: ["training", "Fellow Teacher", "KHEL"],
  sustainability: ["sustainability", "scale", "CSR", "stakeholder"],
  experience: ["KHEL", "Empowering Futures", "outcomes", "Bihar"],
  engagement: ["Cambridge", "fellowship", "narrative"],
  career: ["leadership", "fellowship", "Cambridge"],
};

@Injectable()
export class QueryExpanderService {
  private readonly logger = new Logger(QueryExpanderService.name);

  /**
   * Expand a retrieval query with domain-specific synonyms.
   * Returns the original query augmented with 1-3 relevant synonym terms.
   *
   * @param query Original retrieval query
   * @param sectionName Optional section name for prioritized expansion
   * @returns Expanded query string
   */
  expandQuery(query: string, sectionName?: string): string {
    const queryLower = query.toLowerCase();
    const expansions: string[] = [];

    // Get section-specific priorities if available
    const sectionKey = sectionName ? this.normalizeSectionName(sectionName) : null;
    const priorities = sectionKey ? SECTION_EXPANSION_PRIORITY[sectionKey] : null;

    // Find matching synonyms in query
    const candidates: Array<{ term: string; synonyms: string[]; priority: number }> = [];

    for (const [term, synonyms] of Object.entries(DOMAIN_SYNONYMS)) {
      if (queryLower.includes(term.toLowerCase())) {
        const priority = priorities?.indexOf(term) ?? 999;
        candidates.push({ term, synonyms, priority });
      }
    }

    // Sort by priority (section-relevant first), then take top 3
    candidates.sort((a, b) => a.priority - b.priority);

    for (const candidate of candidates.slice(0, 3)) {
      // Add first 1-2 synonyms per matched term
      const toAdd = candidate.synonyms.slice(0, 2);
      expansions.push(...toAdd);
    }

    if (expansions.length === 0) return query;

    const expanded = `${query} ${expansions.join(" ")}`;

    // Keep under 500 chars to avoid embedding truncation
    return expanded.slice(0, 500);
  }

  /**
   * Expand all queries in a batch, returning originals + expanded versions.
   * Does NOT duplicate if expansion produces identical query.
   */
  expandQueries(queries: string[], sectionName?: string): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const q of queries) {
      if (!seen.has(q)) {
        result.push(q);
        seen.add(q);
      }
      const expanded = this.expandQuery(q, sectionName);
      if (expanded !== q && !seen.has(expanded)) {
        result.push(expanded);
        seen.add(expanded);
      }
    }

    return result;
  }

  /**
   * Generate retry expansion queries when initial retrieval fails.
   * Uses broader synonym terms and section-specific fallbacks.
   */
  generateRetryQueries(sectionName: string, originalQueries: string[]): string[] {
    const sectionKey = this.normalizeSectionName(sectionName);
    const retryTerms: string[] = [];

    // Add section-priority terms as standalone queries
    const priorities = SECTION_EXPANSION_PRIORITY[sectionKey] ?? [];
    for (const term of priorities.slice(0, 3)) {
      const synonyms = DOMAIN_SYNONYMS[term];
      if (synonyms) {
        retryTerms.push(`Diksha Foundation ${term} ${synonyms[0]}`);
      }
    }

    // Add broader versions of original queries (strip very specific terms)
    for (const q of originalQueries.slice(0, 2)) {
      const broader = q
        .replace(/\b\d{4}\b/g, "") // Remove years
        .replace(/\b(specific|exact|detailed|precise)\b/gi, "")
        .trim();
      if (broader.length > 10 && broader !== q) {
        retryTerms.push(broader);
      }
    }

    return retryTerms.slice(0, 5);
  }

  private normalizeSectionName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes("budget") || lower.includes("financial")) return "budget";
    if (lower.includes("objective") || lower.includes("goal")) return "objectives";
    if (lower.includes("monitor") || lower.includes("evaluat") || lower.includes("m&e")) return "monitoring";
    if (lower.includes("result") || lower.includes("outcome") || lower.includes("impact")) return "results";
    if (lower.includes("need") || lower.includes("problem") || lower.includes("rationale") || lower.includes("context") || lower.includes("background")) return "need";
    if (lower.includes("activit") || lower.includes("implementation")) return "activities";
    if (lower.includes("beneficiar") || lower.includes("target")) return "beneficiaries";
    if (lower.includes("team") || lower.includes("staff")) return "team";
    if (lower.includes("sustainab") || lower.includes("exit")) return "sustainability";
    if (lower.includes("experience") || lower.includes("track record")) return "experience";
    return lower;
  }
}
