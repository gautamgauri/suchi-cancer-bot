import { Injectable, Logger } from "@nestjs/common";
import { FundingLlmService } from "../../core_ai/funding-llm.service";
import { EvidenceChunk } from "../../core_ai/types";
import { ProposalScope } from "../proposal.types";
import { SECTION_WRITER_SYSTEM_PROMPT, SECTION_WRITER_NO_EVIDENCE_SYSTEM_PROMPT, buildSectionWriterUserPrompt, getSectionTypeGuidance, CATEGORY_GUIDANCE_MAP } from "../prompts/section-writer.prompt";

@Injectable()
export class SectionWriterService {
  private readonly logger = new Logger(SectionWriterService.name);

  constructor(private readonly llm: FundingLlmService) {}

  /**
   * Draft a section using retrieved evidence chunks with citation markers.
   * Returns draft text with [citation:docId:chunkId] markers and list of gaps.
   */
  async draftSection(params: {
    sectionName: string;
    sectionGuidance: string;
    chunks: EvidenceChunk[];
    /** Optional org context for template-based drafting when no evidence is available */
    orgContext?: string;
    /** Funder name + program for context */
    funderContext?: string;
    /** Canonical scope from planner — locks numbers across sections */
    proposalScope?: ProposalScope;
    /** Framework intelligence context for this section type */
    frameworkContext?: string;
    /** Document type category — injects category-specific guidance into the prompt */
    docTypeCategory?: string;
    /** Override the system prompt entirely (e.g. FELLOWSHIP_SECTION_PROMPT for first-person voice) */
    systemPromptOverride?: string;
  }): Promise<{ draftText: string; gaps: string[] }> {
    if (params.chunks.length === 0) {
      // No-evidence path: pass category + voice override so fellowship keeps first-person tone
      return this.draftFromTemplate(
        params.sectionName,
        params.sectionGuidance,
        params.orgContext,
        params.docTypeCategory,
        params.systemPromptOverride,
      );
    }

    // Evidence available — proceed with citation-grounded drafting
    // Format chunks with citation tokens prominently displayed for LLM to copy
    const isFellowshipTrack = params.docTypeCategory === "fellowship" || params.docTypeCategory === "tech_accelerator";
    const chunksList = params.chunks
      .map((chunk, idx) => {
        const citation = `[citation:${chunk.docId}:${chunk.chunkId}]`;
        const title = chunk.document?.title || chunk.docId;
        let content = chunk.content.substring(0, 2000) + (chunk.content.length > 2000 ? "..." : "");
        // Fellowship: reframe chunk content from org voice to personal voice
        // This helps Gemini adopt first-person style by making the source material first-person
        if (isFellowshipTrack) {
          content = content
            .replace(/\bDiksha Foundation\b/g, "my organization (Diksha Foundation)")
            .replace(/\bThe organization\b/g, "I")
            .replace(/\bthe organization\b/g, "I")
            .replace(/\bOur program\b/g, "My program")
            .replace(/\bour program\b/g, "my program");
        }
        return `---
CHUNK ${idx + 1}: ${title}
CITATION TOKEN: ${citation}
CONTENT: ${content}
---`;
      })
      .join("\n\n");

    const sectionTypeReqs = getSectionTypeGuidance(params.sectionName);

    // Inject category-specific guidance when docTypeCategory is provided
    const categoryGuidance = params.docTypeCategory
      ? CATEGORY_GUIDANCE_MAP[params.docTypeCategory] ?? ""
      : "";
    const combinedGuidance = categoryGuidance
      ? `${params.sectionGuidance}\n\n${categoryGuidance}`
      : params.sectionGuidance;

    let userPrompt = buildSectionWriterUserPrompt({
      sectionName: params.sectionName,
      sectionGuidance: combinedGuidance,
      chunksList,
      funderContext: params.funderContext,
      sectionTypeRequirements: sectionTypeReqs ?? undefined,
      orgContext: params.orgContext,
      proposalScope: params.proposalScope,
      frameworkContext: params.frameworkContext,
      docTypeCategory: params.docTypeCategory,
    });

    // Fellowship voice override: LLM tends to ignore system prompt first-person instruction
    // when evidence chunks are org-centric. This postfix with a concrete example forces compliance.
    if (isFellowshipTrack) {
      // Extract target_words from sectionGuidance (format: "Target words: N. Must answer: ...")
      const wordMatch = params.sectionGuidance.match(/Target words:\s*(\d+)/i);
      const targetWords = wordMatch ? parseInt(wordMatch[1], 10) : 0;
      const wordLimitBlock = targetWords > 0
        ? `\nWORD LIMIT (HARD CONSTRAINT):
- This section MUST be ${targetWords} words or fewer. Not ${targetWords + 100}. Not ${targetWords + 200}. EXACTLY ${targetWords} or fewer.
- Count your words before finalizing. If over ${targetWords}, CUT paragraphs until you are under.
- Front-load the most compelling content. Better to be 250 words and punchy than 500 words and diluted.`
        : "";

      userPrompt += `\n\n=== MANDATORY VOICE OVERRIDE (fellowship) ===
You are writing as Gautam Gauri — a real person applying for a fellowship. Every sentence MUST use first person singular.
${wordLimitBlock}

PERSONAL ANECDOTES (REQUIRED):
- Include at least ONE specific personal anecdote — a named moment, person, date, or experience that only Gautam would know.
- GOOD: "In March 2024, when I watched Priya — a 14-year-old from Bihta — lead her first reflection circle, I realized..."
- GOOD: "My mother Suchitra's cancer diagnosis in 2019 changed how I thought about healthcare access in Bihar."
- BAD: "Through my work, I have seen the impact of education on communities." (too generic, could be anyone)
- Draw from the evidence chunks and applicant profile for real names, dates, and events.

CORRECT VOICE EXAMPLE:
"I founded Diksha Foundation in 2019 after returning from Cambridge, driven by my firsthand experience of educational inequality in Bihar. My KHEL centers now serve 476 children, and I have built AI tools like the Suchi Cancer Bot to extend my impact beyond direct service delivery."

WRONG — DO NOT WRITE LIKE THIS:
"Diksha Foundation was founded in 2019. The organization serves 476 children through its KHEL centers. We have developed AI tools..."

RULES:
- Start sentences with "I" or "My" where possible
- Say "I founded" not "Diksha Foundation was founded"
- Say "my team" not "our team"
- Say "my KHEL centers" not "the KHEL centers"
- NEVER use "we", "our", "the organization", "Diksha Foundation proposes"
=== END VOICE OVERRIDE ===`;
    }

    // Determine which system prompt to use
    const systemPrompt = params.systemPromptOverride || SECTION_WRITER_SYSTEM_PROMPT;

    try {
      const llmStart = Date.now();
      let draftText = await this.llm.generatePlain(
        systemPrompt,
        "Draft the section:",
        userPrompt,
      );
      const llmMs = Date.now() - llmStart;

      // Fellowship voice post-processing: Gemini 2.0 Flash stubbornly writes org voice
      // despite all prompt-level instructions. As a last resort, mechanically rewrite
      // organizational pronouns to first-person singular.
      if (isFellowshipTrack) {
        draftText = this.rewriteToFirstPerson(draftText);

        // Condensation pass: if word count exceeds target × 1.3, call LLM to condense
        const wordMatch = params.sectionGuidance.match(/Target words:\s*(\d+)/i);
        const targetWords = wordMatch ? parseInt(wordMatch[1], 10) : 0;
        if (targetWords > 0) {
          const wordCount = draftText.split(/\s+/).length;
          if (wordCount > Math.ceil(targetWords * 1.3)) {
            draftText = await this.condenseFellowshipSection(draftText, targetWords, params.sectionName);
          }
        }
      }

      // Extract gaps from {{MISSING: ...}} placeholders
      const gapMatches = draftText.match(/\{\{MISSING:\s*([^}]+)\}\}/gi);
      const gaps = gapMatches ? gapMatches.map((m) => m.replace(/\{\{MISSING:\s*|\}\}/gi, "").trim()) : [];

      // Count citations in output for debugging
      const citationCount = this.countCitations(draftText);
      this.logger.log({
        section: params.sectionName,
        chunksProvided: params.chunks.length,
        citationsProduced: citationCount,
        gapsDetected: gaps.length,
        draftLength: draftText.length,
        llm_ms: llmMs,
        docTypeCategory: params.docTypeCategory || "default",
      });

      // === CITATION ENFORCEMENT ===
      // If evidence chunks were provided but zero citations found, retry once with strict prompt
      if (params.chunks.length > 0 && citationCount === 0) {
        this.logger.warn({
          message: "CITATION_LEAK: chunks provided but no citations in output — retrying with strict citation prompt",
          section: params.sectionName,
          chunksProvided: params.chunks.length,
        });

        const strictAddendum = `\n\nCRITICAL CITATION REQUIREMENT: Your previous draft contained ZERO citations despite having ${params.chunks.length} evidence chunks available. You MUST cite at least one source. Every factual claim should reference [citation:docId:chunkId] from the provided evidence. Copy the citation tokens EXACTLY as shown in each chunk above.`;
        const retryStart = Date.now();
        const retryDraft = await this.llm.generatePlain(
          systemPrompt,
          "Draft the section:",
          userPrompt + strictAddendum,
        );
        const retryMs = Date.now() - retryStart;
        const retryCitationCount = this.countCitations(retryDraft);

        if (retryCitationCount > 0) {
          this.logger.log({
            message: "CITATION_ENFORCEMENT_SUCCESS: retry produced citations",
            section: params.sectionName,
            retryCitationCount,
            retry_ms: retryMs,
          });
          draftText = retryDraft;
        } else {
          this.logger.warn({
            message: "CITATION_ENFORCEMENT_FAILED: retry still produced 0 citations — using original draft",
            section: params.sectionName,
            retry_ms: retryMs,
          });
        }
      }

      return { draftText, gaps };
    } catch (e) {
      this.logger.error("Failed to draft section", (e as Error).message);
      return {
        draftText: `## ${params.sectionName}\n\nError generating draft: ${(e as Error).message}`,
        gaps: [`Drafting failed: ${(e as Error).message}`],
      };
    }
  }

  /**
   * Post-process: mechanically rewrite org voice → first-person singular.
   * Gemini 2.0 Flash ignores prompt-level first-person instructions, so we
   * do a deterministic string replacement as a last resort.
   */
  private rewriteToFirstPerson(text: string): string {
    let result = text;
    // First occurrence of "Diksha Foundation" → "my organization, Diksha Foundation"
    // Subsequent occurrences → leave as-is (natural)
    let firstDikshaReplaced = false;
    result = result.replace(/\bDiksha Foundation\b/g, (match) => {
      if (!firstDikshaReplaced) {
        firstDikshaReplaced = true;
        return "my organization, Diksha Foundation";
      }
      return match; // leave subsequent mentions natural
    });
    // "Our" → "My" (start of sentence)
    result = result.replace(/\bOur\b/g, "My");
    // "our" → "my" (mid-sentence)
    result = result.replace(/\bour\b/g, "my");
    // "We" → "I" (start of sentence)
    result = result.replace(/\bWe\b/g, "I");
    // "we" → "I" (mid-sentence)
    result = result.replace(/\bwe\b/g, "I");
    // Fix grammar: "I have" not "I has", "I are" → "I am"
    result = result.replace(/\bI has\b/g, "I have");
    result = result.replace(/\bI are\b/g, "I am");
    result = result.replace(/\bI operates\b/g, "I operate");
    result = result.replace(/\bI serves\b/g, "I serve");
    result = result.replace(/\bI proposes\b/g, "I propose");
    result = result.replace(/\bI ensures\b/g, "I ensure");
    result = result.replace(/\bI delivers\b/g, "I deliver");
    result = result.replace(/\bI provides\b/g, "I provide");
    result = result.replace(/\bI aims\b/g, "I aim");
    result = result.replace(/\bI seeks\b/g, "I seek");
    result = result.replace(/\bI maintains\b/g, "I maintain");
    result = result.replace(/\bI offers\b/g, "I offer");
    // "The organization" → "I"
    result = result.replace(/\bThe organization\b/g, "I");
    result = result.replace(/\bthe organization\b/g, "I");
    this.logger.log({ diagnostic: "FELLOWSHIP_VOICE_REWRITE", applied: true });
    return result;
  }

  /**
   * Count citation markers in generated text.
   * Matches [citation:...], [Source N], [N], and [Evidence ...] patterns.
   */
  private countCitations(text: string): number {
    const citationPattern = /\[citation:[^\]]+\]|\[Source\s*\d+\]|\[\d+\]|\[Evidence[^\]]*\]/g;
    const matches = text.match(citationPattern);
    return matches ? matches.length : 0;
  }

  /**
   * Draft a section using org context when no evidence chunks are available.
   * Uses a dedicated no-evidence system prompt (voice/tone rules without
   * citation mandate) and section-type guidance.
   */
  private async draftFromTemplate(
    sectionName: string,
    sectionGuidance: string,
    orgContext?: string,
    docTypeCategory?: string,
    systemPromptOverride?: string,
  ): Promise<{ draftText: string; gaps: string[] }> {
    this.logger.log(`No evidence for "${sectionName}" — attempting template-based draft with org context`);
    const orgInfo = orgContext || "Diksha Foundation / SCCF, programs: KHEL, Life Skills, Fellowship, India (Bihar, Delhi)";

    // Use section-type guidance for structure, same as evidence-based path
    const sectionTypeReqs = getSectionTypeGuidance(sectionName);

    // Inject category-specific guidance when docTypeCategory is provided
    const categoryGuidance = docTypeCategory
      ? CATEGORY_GUIDANCE_MAP[docTypeCategory] ?? ""
      : "";
    const combinedGuidance = categoryGuidance
      ? `${sectionGuidance}\n\n${categoryGuidance}`
      : sectionGuidance;

    const isFellowshipTrack = docTypeCategory === "fellowship" || docTypeCategory === "tech_accelerator";
    const voiceInstruction = isFellowshipTrack
      ? `- Write in FIRST PERSON SINGULAR ("I", "my work", "my team at Diksha Foundation"). NEVER use "we", "our team", or organizational voice.
- Include at least ONE specific personal anecdote — a named moment, person, date, or experience.`
      : `- Write in first person plural ("We", "Our team")`;
    const contextLabel = isFellowshipTrack
      ? "Applicant profile (write from THIS person's perspective):"
      : "Organization context:";

    // Extract word limit for hard enforcement
    const wordMatch = sectionGuidance.match(/Target words:\s*(\d+)/i);
    const targetWords = wordMatch ? parseInt(wordMatch[1], 10) : 0;
    const wordLimitLine = isFellowshipTrack && targetWords > 0
      ? `\n- HARD WORD LIMIT: ${targetWords} words maximum. Count your words. Cut if over.`
      : "";

    const templatePrompt = `Section: ${sectionName}
Guidance: ${combinedGuidance}
${sectionTypeReqs ? `\nSection-specific requirements:\n${sectionTypeReqs}` : ""}

${contextLabel}
${orgInfo}

Write a professional draft for this section. No evidence documents are available, so:
- Use the context thoroughly — it contains real data (center names, beneficiary counts, staff, board, partners, compliance details)
${voiceInstruction}
- Write flowing narrative prose, not bullet lists
- Mark only TRULY unknown data with {{VERIFY: description}} — do NOT use placeholders for data available in the context
- Use Indian English conventions and INR formatting (₹15,00,000 not ₹1,500,000)${wordLimitLine}`;

    // Use system prompt override (e.g. FELLOWSHIP_SECTION_PROMPT) if provided,
    // otherwise fall back to the standard no-evidence prompt
    const systemPrompt = systemPromptOverride || SECTION_WRITER_NO_EVIDENCE_SYSTEM_PROMPT;

    try {
      const llmStart = Date.now();
      let draftText = await this.llm.generatePlain(
        systemPrompt,
        "Draft the section:",
        templatePrompt,
      );
      const llmMs = Date.now() - llmStart;

      // Fellowship voice post-processing (same as evidence path)
      if (isFellowshipTrack) {
        draftText = this.rewriteToFirstPerson(draftText);
      }

      this.logger.log({ section: sectionName, template: true, llm_ms: llmMs, draftLength: draftText.length });

      // Extract gaps from placeholders
      const verifyMatches = draftText.match(/\{\{(?:VERIFY|INSERT|MISSING):\s*([^}]+)\}\}/gi) || [];
      const gaps = [
        `No evidence retrieved for ${sectionName} — template draft used`,
        ...verifyMatches.map((m) => m.replace(/\{\{(?:VERIFY|INSERT|MISSING):\s*|\}\}/gi, "").trim()),
      ];

      return { draftText, gaps };
    } catch (e) {
      this.logger.error(`Template draft failed for "${sectionName}"`, (e as Error).message);
      return {
        draftText: `## ${sectionName}\n\n{{MISSING: Evidence required for ${sectionName}}}`,
        gaps: [`No evidence retrieved for ${sectionName}`],
      };
    }
  }

  /**
   * Condense an over-length fellowship section to the target word count.
   */
  private async condenseFellowshipSection(
    draftText: string,
    targetWords: number,
    sectionName: string,
  ): Promise<string> {
    const prompt = `Condense the following fellowship section to exactly ${targetWords} words or fewer.

RULES:
- Keep personal anecdotes, specific details (names, dates, numbers), and citations [citation:...].
- Cut generic statements, repeated project descriptions, and any budget references.
- Maintain first-person singular voice throughout.
- Do NOT add new content — only cut and tighten existing text.
- Output ONLY the condensed section text, no preamble.

SECTION "${sectionName}":
${draftText}`;

    try {
      const condensed = await this.llm.generatePlain(
        "You are an expert editor. Condense text to a target word count while preserving the most compelling content.",
        "Condense:",
        prompt,
      );
      const newCount = condensed.split(/\s+/).length;
      this.logger.log({
        diagnostic: "FELLOWSHIP_CONDENSATION",
        section: sectionName,
        originalWords: draftText.split(/\s+/).length,
        condensedWords: newCount,
        targetWords,
      });
      return condensed;
    } catch (e) {
      this.logger.warn(`Condensation failed for "${sectionName}", using original draft: ${(e as Error).message}`);
      return draftText;
    }
  }
}
