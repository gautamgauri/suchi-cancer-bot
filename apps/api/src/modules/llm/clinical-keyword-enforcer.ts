import { Injectable, Logger } from "@nestjs/common";
import { PatientState } from "../chat/patient-state.service";

/**
 * A single keyword enforcement rule.
 * At least one of the `required` terms (or their synonyms) must appear in the response.
 */
export interface KeywordRule {
  cancerType: string;
  patientState: string; // 'symptomatic' | 'informational' | 'post_diagnosis' | 'caregiver' | 'any'
  required: string[];   // at least one must be present
  synonyms: Record<string, string[]>; // term -> acceptable alternatives
  injection?: string;   // sentence to append if ALL required terms are missing
}

/**
 * Post-processing layer that ensures critical medical terms appear in responses.
 *
 * Pure string processing — no LLM calls.  Runs after response generation but
 * before the disclaimer is appended.
 *
 * Two modes of action:
 *   1. **Synonym swap** — if a synonym is present but not the canonical term,
 *      replace one occurrence with the canonical term.
 *   2. **Injection** — if neither the canonical term nor any synonym is found,
 *      append a short clinically-relevant sentence.
 */
@Injectable()
export class ClinicalKeywordEnforcerService {
  private readonly logger = new Logger(ClinicalKeywordEnforcerService.name);

  private readonly rules: KeywordRule[] = [
    // ── Breast ─────────────────────────────────────────────────────────
    {
      cancerType: "breast",
      patientState: "symptomatic",
      required: ["mammogram"],
      synonyms: { mammogram: ["mammography", "mammographic"] },
      injection: "Your doctor may recommend a mammogram (breast X-ray) as a first step.",
    },
    {
      cancerType: "breast",
      patientState: "informational",
      required: ["mammogram"],
      synonyms: { mammogram: ["mammography", "mammographic"] },
      injection: "Your doctor may recommend a mammogram (breast X-ray) as a first step.",
    },
    {
      cancerType: "breast",
      patientState: "any",
      required: ["biopsy", "ultrasound"],
      synonyms: {},
    },

    // ── Colorectal ─────────────────────────────────────────────────────
    {
      cancerType: "colorectal",
      patientState: "symptomatic",
      required: ["colonoscopy"],
      synonyms: { colonoscopy: ["colonoscopic"] },
      injection: "Your doctor may recommend a colonoscopy to examine the colon.",
    },
    {
      cancerType: "colorectal",
      patientState: "informational",
      required: ["colonoscopy"],
      synonyms: { colonoscopy: ["colonoscopic"] },
      injection: "Your doctor may recommend a colonoscopy to examine the colon.",
    },

    // ── Cervical ───────────────────────────────────────────────────────
    {
      cancerType: "cervical",
      patientState: "informational",
      required: ["vaccine"],
      synonyms: { vaccine: ["vaccination", "vaccinate", "Gardasil"] },
      injection: "HPV vaccine is available and can help prevent cervical cancer.",
    },

    // ── Lung ───────────────────────────────────────────────────────────
    {
      cancerType: "lung",
      patientState: "symptomatic",
      required: ["CT scan"],
      synonyms: { "CT scan": ["CT", "computed tomography"] },
    },
    {
      cancerType: "lung",
      patientState: "symptomatic",
      required: ["chest X-ray"],
      synonyms: { "chest X-ray": ["chest x-ray", "X-ray", "x-ray"] },
    },

    // ── Any cancer + caregiver / post_diagnosis ────────────────────────
    {
      cancerType: "any",
      patientState: "caregiver",
      required: ["oncologist"],
      synonyms: { oncologist: ["oncology"] },
      injection: "We recommend consulting with an oncologist for personalized guidance.",
    },
    {
      cancerType: "any",
      patientState: "post_diagnosis",
      required: ["oncologist"],
      synonyms: { oncologist: ["oncology"] },
      injection: "We recommend consulting with an oncologist for personalized guidance.",
    },
  ];

  /**
   * Enforce clinical keyword rules on a response.
   *
   * @param responseText  — the response to check / modify
   * @param cancerType    — detected cancer type (e.g. "breast", "lung"), or null
   * @param patientState  — patient journey state from PatientStateService
   * @returns the (possibly modified) response text
   */
  enforce(
    responseText: string,
    cancerType: string | null,
    patientState: PatientState,
  ): string {
    if (!responseText || responseText.trim().length === 0) {
      return responseText;
    }

    const normalizedCancerType = cancerType?.toLowerCase() ?? null;
    const stateKey = this.patientStateToRuleKey(patientState);

    const applicableRules = this.rules.filter(
      (rule) =>
        (rule.cancerType === "any" || rule.cancerType === normalizedCancerType) &&
        (rule.patientState === "any" || rule.patientState === stateKey),
    );

    if (applicableRules.length === 0) {
      return responseText;
    }

    let modified = responseText;
    const injections: string[] = [];

    for (const rule of applicableRules) {
      const result = this.applyRule(modified, rule);
      modified = result.text;
      if (result.injected) {
        injections.push(result.injected);
      }
    }

    if (injections.length > 0) {
      this.logger.log({
        event: "clinical_keyword_injection",
        cancerType: normalizedCancerType,
        patientState: stateKey,
        injectedCount: injections.length,
      });
    }

    return modified;
  }

  /**
   * Apply a single keyword rule.
   *
   * Returns the (possibly modified) text and any injection sentence that was appended.
   */
  private applyRule(
    text: string,
    rule: KeywordRule,
  ): { text: string; injected: string | null } {
    const lower = text.toLowerCase();

    // Check each required term: is the canonical term or any synonym present?
    const allMissing: string[] = [];

    for (const term of rule.required) {
      const canonicalPresent = lower.includes(term.toLowerCase());
      const synonymList = rule.synonyms[term] || [];
      const synonymPresent = synonymList.some((syn) =>
        lower.includes(syn.toLowerCase()),
      );

      if (canonicalPresent) {
        // Canonical term already present — nothing to do for this term
        continue;
      }

      if (synonymPresent) {
        // Synonym present but not the canonical term — swap one occurrence
        text = this.swapFirstSynonym(text, term, synonymList);
        continue;
      }

      // Neither canonical nor any synonym found
      allMissing.push(term);
    }

    // Only inject if ALL required terms are missing (none present, not even synonyms)
    // If at least one required term (or synonym) was found, don't inject
    if (allMissing.length === rule.required.length && rule.injection) {
      text = this.appendBeforeDisclaimer(text, rule.injection);
      return { text, injected: rule.injection };
    }

    return { text, injected: null };
  }

  /**
   * Replace the first occurrence of any synonym with the canonical term.
   * Case-insensitive match, preserves surrounding text.
   */
  private swapFirstSynonym(
    text: string,
    canonicalTerm: string,
    synonyms: string[],
  ): string {
    for (const syn of synonyms) {
      const regex = new RegExp(`\\b${this.escapeRegex(syn)}\\b`, "i");
      const match = text.match(regex);
      if (match) {
        // Replace just the first occurrence
        return text.slice(0, match.index!) + canonicalTerm + text.slice(match.index! + match[0].length);
      }
    }
    return text;
  }

  /**
   * Append an injection sentence before the disclaimer / "What to do next" section,
   * or at the end if no such section exists.
   */
  private appendBeforeDisclaimer(text: string, sentence: string): string {
    const insertionPatterns = [
      /(\n\n\*\*What to do next)/i,
      /(\n\n\*\*Questions to Ask)/i,
      /(\n\n\*\*Important:\*\*)/i,
      /(\n\n---\n)/,              // horizontal rule before disclaimer
      /(\n\n\*This information)/i, // common disclaimer opener
    ];

    for (const pattern of insertionPatterns) {
      const match = text.match(pattern);
      if (match && match.index !== undefined) {
        return (
          text.slice(0, match.index) +
          "\n\n" +
          sentence +
          text.slice(match.index)
        );
      }
    }

    // Fallback: append at end
    return text + "\n\n" + sentence;
  }

  /**
   * Map PatientState enum to the string keys used in rules.
   */
  private patientStateToRuleKey(state: PatientState): string {
    switch (state) {
      case PatientState.SYMPTOMATIC:
        return "symptomatic";
      case PatientState.INFORMATIONAL:
        return "informational";
      case PatientState.POST_DIAGNOSIS:
        return "post_diagnosis";
      case PatientState.CAREGIVER:
        return "caregiver";
      case PatientState.URGENT:
        return "symptomatic"; // urgent implies symptomatic for keyword purposes
      case PatientState.SIDE_EFFECTS:
        return "post_diagnosis"; // side effects implies post-diagnosis context
      default:
        return "informational";
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
