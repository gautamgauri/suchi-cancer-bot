import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { EvidenceChunk } from "../../core_ai/types";
import { ProposalScope } from "../proposal.types";

/**
 * Structured factsheet: verified data points that section writers MUST use instead of hallucinating.
 * Kills {{VERIFY}} placeholders by pre-resolving data from org profile, activity registry, and evidence.
 */
export interface Factsheet {
  /** Organisation identity */
  org: {
    legalName: string;
    registrationNumber: string;
    pan: string;
    established: string;
    certifications: string[];
    annualBudget: string;
  };
  /** Board members with roles */
  board: Array<{ name: string; role: string; credentials: string }>;
  /** Leadership team */
  leadership: Array<{ name: string; title: string; credentials: string }>;
  /** Program data from scope + activity registry */
  program: {
    name: string;
    centers: Array<{ name: string; beneficiaries?: string }>;
    totalBeneficiaries: string;
    geography: string;
    grantPeriod: string;
    budgetCeiling: string | null;
  };
  /** Key metrics: verified numbers with sources */
  metrics: Array<{ metric: string; value: string; source: string }>;
  /** Current and past funders */
  funders: { current: string[]; past: string[] };
  /** Compliance details */
  compliance: {
    fcraStatus: string;
    csrRegistration: string;
    auditFirm: string;
    gstStatus: string;
  };
  /** Additional facts extracted from evidence chunks */
  evidenceFacts: Array<{ fact: string; citation: string }>;
}

const FACTSHEET_EXTRACTION_PROMPT = `You are a data extraction assistant. Given organization context, activity data, and evidence chunks, extract ONLY verified factual data points. Do NOT infer, estimate, or hallucinate.

Return a JSON object with this structure:
{
  "metrics": [{"metric": "description", "value": "exact number/date", "source": "where this comes from"}],
  "evidenceFacts": [{"fact": "specific verified fact", "citation": "citation token from chunks"}]
}

Rules:
- Only include facts with explicit supporting evidence
- Numbers must be exact as stated in source material
- Dates must be exact
- If evidence is ambiguous, skip it — omission is better than error
- For metrics, prefer quantitative data: beneficiary counts, attendance %, funding amounts, dates, staff counts
- For evidenceFacts, extract key claims that section writers would otherwise mark as {{VERIFY}}`;

@Injectable()
export class FactsheetBuilderService {
  private readonly logger = new Logger(FactsheetBuilderService.name);

  constructor(private readonly llm: FundingLlmService) {}

  /**
   * Build a structured factsheet from known org data, scope, activity facts, and evidence chunks.
   * Phase 1 (deterministic): extract from structured data — zero LLM calls.
   * Phase 2 (LLM-assisted): extract additional facts from evidence chunks — 1 LLM call.
   */
  async buildFactsheet(params: {
    orgProfile: string;
    scope?: ProposalScope;
    activityFacts?: Record<string, unknown>;
    evidenceChunks?: EvidenceChunk[];
  }): Promise<Factsheet> {
    const start = Date.now();

    // Phase 1: Deterministic extraction from org profile
    const factsheet = this.extractFromOrgProfile(params.orgProfile, params.scope, params.activityFacts);

    // Phase 2: LLM-assisted extraction from evidence chunks (if available)
    if (params.evidenceChunks && params.evidenceChunks.length > 0) {
      try {
        const extracted = await this.extractFromEvidence(params.evidenceChunks);
        factsheet.metrics.push(...extracted.metrics);
        factsheet.evidenceFacts.push(...extracted.evidenceFacts);
      } catch (e) {
        this.logger.warn(`LLM evidence extraction failed (non-fatal): ${(e as Error).message}`);
      }
    }

    this.logger.log({
      diagnostic: "FACTSHEET_BUILT",
      metricsCount: factsheet.metrics.length,
      evidenceFactsCount: factsheet.evidenceFacts.length,
      boardMembers: factsheet.board.length,
      centers: factsheet.program.centers.length,
      duration_ms: Date.now() - start,
    });

    return factsheet;
  }

  /**
   * Format factsheet as context block for section writers.
   */
  formatFactsheetForPrompt(factsheet: Factsheet): string {
    const lines: string[] = [
      "## VERIFIED FACTSHEET (use these facts — do NOT use {{VERIFY}} for any data listed here)",
      "",
      "### Organization",
      `- Legal Name: ${factsheet.org.legalName}`,
      `- Registration: ${factsheet.org.registrationNumber}`,
      `- PAN: ${factsheet.org.pan}`,
      `- Established: ${factsheet.org.established}`,
      `- Certifications: ${factsheet.org.certifications.join(", ")}`,
      `- Annual Budget: ${factsheet.org.annualBudget}`,
      "",
      "### Board of Directors",
      ...factsheet.board.map(b => `- ${b.name} (${b.role}): ${b.credentials}`),
      "",
      "### Leadership",
      ...factsheet.leadership.map(l => `- ${l.name} — ${l.title}: ${l.credentials}`),
      "",
      "### Program Data",
      `- Program: ${factsheet.program.name}`,
      `- Centers: ${factsheet.program.centers.map(c => `${c.name}${c.beneficiaries ? ` (${c.beneficiaries})` : ""}`).join("; ")}`,
      `- Total Beneficiaries: ${factsheet.program.totalBeneficiaries}`,
      `- Geography: ${factsheet.program.geography}`,
      `- Grant Period: ${factsheet.program.grantPeriod}`,
      ...(factsheet.program.budgetCeiling ? [`- Budget Ceiling: ${factsheet.program.budgetCeiling}`] : []),
      "",
      "### Funding Partners",
      `- Current: ${factsheet.funders.current.join(", ")}`,
      `- Past: ${factsheet.funders.past.join(", ")}`,
      "",
      "### Compliance",
      `- FCRA: ${factsheet.compliance.fcraStatus}`,
      `- CSR: ${factsheet.compliance.csrRegistration}`,
      `- Audit: ${factsheet.compliance.auditFirm}`,
      `- GST: ${factsheet.compliance.gstStatus}`,
    ];

    if (factsheet.metrics.length > 0) {
      lines.push("", "### Verified Metrics");
      for (const m of factsheet.metrics) {
        lines.push(`- ${m.metric}: ${m.value} (source: ${m.source})`);
      }
    }

    if (factsheet.evidenceFacts.length > 0) {
      lines.push("", "### Evidence-Backed Facts");
      for (const f of factsheet.evidenceFacts) {
        lines.push(`- ${f.fact} ${f.citation}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Validate draft output for {{VERIFY}}/{{MISSING}}/{{INSERT}} placeholders
   * that reference data available in the factsheet.
   * Returns list of resolvable placeholders with their factsheet values.
   */
  findResolvablePlaceholders(
    draftText: string,
    factsheet: Factsheet,
  ): Array<{ placeholder: string; suggestedValue: string }> {
    const placeholders = draftText.matchAll(/\{\{(?:VERIFY|MISSING|INSERT):\s*([^}]+)\}\}/gi);
    const resolvable: Array<{ placeholder: string; suggestedValue: string }> = [];
    const factsheetText = this.formatFactsheetForPrompt(factsheet).toLowerCase();

    for (const match of placeholders) {
      const field = match[1].trim().toLowerCase();
      // Check if the factsheet contains data that could resolve this placeholder
      const keywords = field.split(/[\s,]+/).filter(w => w.length > 3);
      const matchCount = keywords.filter(kw => factsheetText.includes(kw)).length;
      if (matchCount >= Math.ceil(keywords.length * 0.4)) {
        // Factsheet likely has this data — flag it as resolvable
        resolvable.push({
          placeholder: match[0],
          suggestedValue: `[Available in factsheet — search for: ${keywords.slice(0, 3).join(", ")}]`,
        });
      }
    }

    return resolvable;
  }

  // ─── Private helpers ──────────────────────────────────────────

  private extractFromOrgProfile(
    orgProfile: string,
    scope?: ProposalScope,
    activityFacts?: Record<string, unknown>,
  ): Factsheet {
    return {
      org: {
        legalName: "Diksha Foundation",
        registrationNumber: "S/RS/SW/0019/2010",
        pan: "AABTD9924D",
        established: "2010",
        certifications: ["12A", "80G", "FCRA", "CSR-1"],
        annualBudget: "₹104.56 lakhs (FY 2024-25)",
      },
      board: [
        { name: "Gautam Gauri", role: "President", credentials: "Co-founder & Executive Director; MPhil Education (Cambridge); 15 years education sector" },
        { name: "Saurabh Kumar", role: "Treasurer", credentials: "Co-founder and COO at Sparklehood; angel investor with startup ecosystem expertise" },
        { name: "Mohita Katriar", role: "Secretary", credentials: "Education professional; Master's in Education (TISS); academic leadership" },
        { name: "Harish Nandan Sahay", role: "Director", credentials: "25+ years national experience; corporate-to-social sector transition; Amity Foundation" },
        { name: "Arti Nair", role: "Director", credentials: "Master's in Philosophy (Cambridge); children's literature, curriculum development, teacher training" },
        { name: "Vikas Gupta", role: "Director", credentials: "Entrepreneur and investor in retail-tech; strategic advisor on business transformation" },
        { name: "Dr. Nandini Jha", role: "Director", credentials: "MD Radiologist; advanced imaging and musculoskeletal diagnostics" },
      ],
      leadership: [
        { name: "Gautam Gauri", title: "Executive Director & Co-founder", credentials: "MPhil Education (Cambridge University); 15+ years nonprofit leadership" },
        { name: "Shivam Mishra", title: "Education & Community Development Specialist", credentials: "Field operations lead across centers" },
        { name: "Nisha Kumari", title: "Communications Coordinator", credentials: "Communications" },
      ],
      program: {
        name: scope?.programName || "KHEL (Knowledge Hub for Education and Learning)",
        centers: scope?.centers?.map(c => ({
          name: typeof c === "string" ? c : c.name,
          beneficiaries: (activityFacts as Record<string, unknown>)?.centerBeneficiaries
            ? String((activityFacts as Record<string, Record<string, unknown>>).centerBeneficiaries?.[typeof c === "string" ? c : c.name] ?? "")
            : undefined,
        })) || [
          { name: "KHEL Patna (Rukanpura)", beneficiaries: "147 students" },
          { name: "KHEL Bihta (Sita Ram Ashram)", beneficiaries: "150 students" },
          { name: "KHEL Sarairanjan", beneficiaries: "179 students" },
        ],
        totalBeneficiaries: scope?.totalDirectBeneficiaries || String(activityFacts?.totalDirectBeneficiaries ?? "~476 students"),
        geography: scope?.geographicScope || "Patna, Bihta, Samastipur — Bihar, India",
        grantPeriod: typeof scope?.grantPeriod === "string"
          ? scope.grantPeriod
          : scope?.grantPeriod
            ? `${scope.grantPeriod.start ?? ""} – ${scope.grantPeriod.end ?? ""}`.trim()
            : "",
        budgetCeiling: scope?.budgetCeiling ? String(scope.budgetCeiling) : null,
      },
      metrics: this.extractMetricsFromActivityFacts(activityFacts),
      funders: {
        current: [
          "Azim Premji Foundation", "Feeding India", "Ruban Hospital", "eGain Communications",
          "BP Singh & Shakuntla Devi Foundation", "Every.org", "Benevity Causes", "GIVE India",
          "North South Foundation", "Swatantra Talim", "SEE Learning India", "DaanVeda",
          "IndiaDonates", "ArtKaar Collective", "SAATHIYA",
        ],
        past: ["JP Morgan Chase", "PRAVAH", "Commutiny", "Asha for Education", "US Consulate General (Kolkata)"],
      },
      compliance: {
        fcraStatus: "Registered; latest return filed December 2025; no defaults or blacklisting",
        csrRegistration: "CSR-1 registered",
        auditFirm: "Jha BK & Associates (Firm No. 043115N); audited annually",
        gstStatus: "Not registered under GST",
      },
      evidenceFacts: [],
    };
  }

  private extractMetricsFromActivityFacts(activityFacts?: Record<string, unknown>): Factsheet["metrics"] {
    if (!activityFacts) return [];
    const metrics: Factsheet["metrics"] = [];

    if (activityFacts.totalDirectBeneficiaries) {
      metrics.push({ metric: "Total direct beneficiaries", value: String(activityFacts.totalDirectBeneficiaries), source: "activity registry" });
    }
    if (activityFacts.centers) {
      metrics.push({ metric: "Number of centers", value: String((activityFacts.centers as string[]).length), source: "activity registry" });
    }
    if (activityFacts.attendanceRate) {
      metrics.push({ metric: "Average attendance rate", value: String(activityFacts.attendanceRate), source: "activity registry" });
    }
    if (activityFacts.staffCount) {
      metrics.push({ metric: "Total staff", value: String(activityFacts.staffCount), source: "activity registry" });
    }
    // Extract any numeric fields from activity facts
    for (const [key, value] of Object.entries(activityFacts)) {
      if (typeof value === "number" && !["totalDirectBeneficiaries", "staffCount"].includes(key)) {
        metrics.push({ metric: key.replace(/([A-Z])/g, " $1").trim(), value: String(value), source: "activity registry" });
      }
    }

    return metrics;
  }

  private async extractFromEvidence(
    chunks: EvidenceChunk[],
  ): Promise<{ metrics: Factsheet["metrics"]; evidenceFacts: Factsheet["evidenceFacts"] }> {
    // Format top chunks for LLM extraction
    const topChunks = chunks.slice(0, 15);
    const chunksText = topChunks
      .map((c, i) => {
        const citation = `[citation:${c.docId}:${c.chunkId}]`;
        return `CHUNK ${i + 1} ${citation}:\n${c.content.substring(0, 1500)}`;
      })
      .join("\n\n");

    const userPrompt = `Extract verified facts and metrics from these evidence chunks:\n\n${chunksText}\n\nReturn ONLY the JSON object, no markdown fences.`;

    const raw = await this.llm.generatePlain(
      FACTSHEET_EXTRACTION_PROMPT,
      "Extract facts:",
      userPrompt,
    );

    try {
      // Strip markdown fences if present
      const cleaned = raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        metrics: Array.isArray(parsed.metrics) ? parsed.metrics : [],
        evidenceFacts: Array.isArray(parsed.evidenceFacts) ? parsed.evidenceFacts : [],
      };
    } catch {
      this.logger.warn("Failed to parse LLM factsheet extraction output");
      return { metrics: [], evidenceFacts: [] };
    }
  }
}
