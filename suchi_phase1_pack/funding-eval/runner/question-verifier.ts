import axios from "axios";

interface StoredSection {
  name: string;
  targetWords?: number;
  mustAnswer?: string[];
}

interface ExtractedSection {
  name: string;
  targetWords?: number;
  mustAnswer?: string[];
}

interface SectionMatch {
  storedName: string;
  extractedName?: string;
  similarity: number;
  wordLimitMatch: boolean;
  storedWordLimit?: number;
  extractedWordLimit?: number;
}

export interface VerificationResult {
  opportunityId: string;
  sourceUrl?: string;
  storedSectionCount: number;
  extractedSectionCount: number;
  matched: SectionMatch[];
  missingSections: string[];
  extraSections: string[];
  wordLimitMismatches: Array<{
    section: string;
    stored: number | undefined;
    extracted: number | undefined;
  }>;
  passed: boolean;
  summary: string;
}

export class QuestionVerifier {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly timeoutMs: number = 60_000,
  ) {}

  async verify(opportunityId: string): Promise<VerificationResult> {
    const api = axios.create({
      baseURL: this.apiBaseUrl,
      timeout: this.timeoutMs,
    });

    // 1. Fetch opportunity from DB
    const { data: opportunity } = await api.get(`/v1/opportunities/${opportunityId}`);
    const oppPayload = (opportunity as Record<string, unknown>).jsonBlob as {
      opportunity?: {
        sourceUrl?: string;
        extractedRequirements?: { sections?: StoredSection[] };
      };
    };

    const sourceUrl = oppPayload?.opportunity?.sourceUrl;
    const storedSections = oppPayload?.opportunity?.extractedRequirements?.sections || [];

    if (storedSections.length === 0) {
      return {
        opportunityId,
        sourceUrl,
        storedSectionCount: 0,
        extractedSectionCount: 0,
        matched: [],
        missingSections: [],
        extraSections: [],
        wordLimitMismatches: [],
        passed: false,
        summary: "No stored sections found for this opportunity",
      };
    }

    // 2. Re-extract questions from the live URL
    let extractedSections: ExtractedSection[] = [];
    if (sourceUrl) {
      try {
        const { data: extractResult } = await api.post(
          "/v1/applications/extract-questions-from-url",
          { url: sourceUrl },
          { timeout: 120_000 },
        );
        const extracted = extractResult as { sections?: ExtractedSection[]; questions?: Array<{ questionText: string; wordLimit?: number; sectionLabel?: string }> };

        if (extracted.sections) {
          extractedSections = extracted.sections;
        } else if (extracted.questions) {
          // Convert flat questions to sections by sectionLabel
          const sectionMap = new Map<string, ExtractedSection>();
          for (const q of extracted.questions) {
            const label = q.sectionLabel || q.questionText.substring(0, 60);
            if (!sectionMap.has(label)) {
              sectionMap.set(label, {
                name: label,
                targetWords: q.wordLimit,
                mustAnswer: [],
              });
            }
            sectionMap.get(label)!.mustAnswer!.push(q.questionText);
          }
          extractedSections = [...sectionMap.values()];
        }
      } catch (err) {
        return {
          opportunityId,
          sourceUrl,
          storedSectionCount: storedSections.length,
          extractedSectionCount: 0,
          matched: [],
          missingSections: storedSections.map((s) => s.name),
          extraSections: [],
          wordLimitMismatches: [],
          passed: false,
          summary: `Failed to extract from live URL: ${(err as Error).message}`,
        };
      }
    } else {
      return {
        opportunityId,
        storedSectionCount: storedSections.length,
        extractedSectionCount: 0,
        matched: [],
        missingSections: [],
        extraSections: [],
        wordLimitMismatches: [],
        passed: false,
        summary: "No sourceUrl found — cannot verify against live form",
      };
    }

    // 3. Diff: match stored sections to extracted sections
    const matched: SectionMatch[] = [];
    const unmatchedStored = new Set(storedSections.map((s) => s.name));
    const unmatchedExtracted = new Set(extractedSections.map((s) => s.name));

    for (const stored of storedSections) {
      let bestMatch: ExtractedSection | undefined;
      let bestSimilarity = 0;

      for (const extracted of extractedSections) {
        const sim = this.nameSimilarity(stored.name, extracted.name);
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestMatch = extracted;
        }
      }

      if (bestMatch && bestSimilarity >= 0.4) {
        matched.push({
          storedName: stored.name,
          extractedName: bestMatch.name,
          similarity: bestSimilarity,
          wordLimitMatch: stored.targetWords === bestMatch.targetWords,
          storedWordLimit: stored.targetWords,
          extractedWordLimit: bestMatch.targetWords,
        });
        unmatchedStored.delete(stored.name);
        unmatchedExtracted.delete(bestMatch.name);
      }
    }

    const wordLimitMismatches = matched
      .filter((m) => !m.wordLimitMatch && (m.storedWordLimit || m.extractedWordLimit))
      .map((m) => ({
        section: m.storedName,
        stored: m.storedWordLimit,
        extracted: m.extractedWordLimit,
      }));

    const missingSections = [...unmatchedStored];
    const extraSections = [...unmatchedExtracted];

    const passed = missingSections.length === 0 &&
      extraSections.length === 0 &&
      wordLimitMismatches.length === 0;

    const summary = passed
      ? `All ${matched.length} sections verified — names and word limits match`
      : `${matched.length} matched, ${missingSections.length} missing, ${extraSections.length} extra, ${wordLimitMismatches.length} word-limit mismatches`;

    return {
      opportunityId,
      sourceUrl,
      storedSectionCount: storedSections.length,
      extractedSectionCount: extractedSections.length,
      matched,
      missingSections,
      extraSections,
      wordLimitMismatches,
      passed,
      summary,
    };
  }

  /**
   * Simple word-overlap similarity between two section names.
   */
  private nameSimilarity(a: string, b: string): number {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    const wordsA = normalize(a);
    const wordsB = normalize(b);

    if (wordsA.length === 0 || wordsB.length === 0) return 0;

    const setB = new Set(wordsB);
    const matches = wordsA.filter((w) => setB.has(w)).length;
    return matches / Math.max(wordsA.length, wordsB.length);
  }
}
