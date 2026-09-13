/**
 * Output Verifier — Phase 3
 *
 * Final policy check on every response before it reaches the user.
 * Runs AFTER the executor produces content (template or LLM).
 *
 * Checks:
 *  1. No diagnosis: response must not diagnose cancer
 *  2. No prognosis: response must not predict survival/life expectancy
 *  3. No dosage: response must not recommend specific drug doses
 *  4. Has disclaimer: medical disclaimer must be present
 *  5. Has citations: medical content must reference sources
 *  6. Appropriate tone: empathetic, non-judgmental
 *  7. No ungrounded entities: medical entities must be from evidence
 *
 * All checks are rule-based (zero LLM cost).
 * The verifier can auto-fix some violations (add disclaimer, adjust tone).
 */

import { Injectable, Logger } from "@nestjs/common";
import { EvidenceChunk } from "../evidence/evidence-gate.service";
import { VerifyCheck } from "./execution-planner.service";
import { hasDisclaimer } from "../safety/disclaimer-engine";
import { normalizeForMatch } from "../safety/text-normalizer";

// ─── Interfaces ────────────────────────────────────────────────

export interface PolicyViolation {
  check: VerifyCheck;
  severity: "critical" | "warning";
  detail: string;
  /** Whether this violation was auto-fixed */
  autoFixed: boolean;
}

export interface VerificationResult {
  /** Whether the response passed all checks */
  passed: boolean;
  /** Violations found */
  violations: PolicyViolation[];
  /** Content with auto-fixes applied (if any) */
  fixedContent: string | null;
  /** Summary for logging */
  summary: string;
}

// ─── Patterns ──────────────────────────────────────────────────

// Diagnosis patterns (response MUST NOT contain these)
const DIAGNOSIS_PATTERNS = [
  /\byou (have|likely have|probably have|are suffering from|are diagnosed with)\b/i,
  /\bthis (is|looks like|appears to be|indicates|confirms|suggests you have)\s+(cancer|carcinoma|tumor|lymphoma|leukemia)/i,
  /\byour (cancer|diagnosis|condition) is\b/i,
  /\bbased on (your|the) (symptoms|report|results),?\s*(you|it|this)\s*(have|is|appears|seems|suggests)\b/i,
  /\bI can confirm\b/i,
  /\bmy diagnosis is\b/i,
  // Hindi — NO \b: JavaScript word boundaries only recognize ASCII [A-Za-z0-9_],
  // so a \b adjacent to Devanagari never matches and silently disables the rule.
  /(आपको|तुम्हें|आपके|इन्हें) (कैंसर|ट्यूमर|कार्सिनोमा) है/,
  /यह (कैंसर|ट्यूमर|कार्सिनोमा) (ही )?है/,
  /(जांच|रिपोर्ट|टेस्ट) (के अनुसार|से (पता चलता है|लगता है)).{0,20}(कैंसर|ट्यूमर) है/,
  // Romanized Hindi
  /\b(aapko|aapke|tumhe|tumhein|inhe)\s+(cancer|tumor|kainsar|kainser)\s+hai\b/i,
  /\byeh\s+(cancer|tumor|kainsar)\s+(hi\s+)?hai\b/i,
];

// Prognosis patterns (response MUST NOT contain these)
const PROGNOSIS_PATTERNS = [
  /\byou (will|can|might) (live|survive|die)\b/i,
  /\b(survival|life expectancy|prognosis) (is|of|for you)\b.*\b\d+\s*(year|month|week|day)/i,
  /\b\d+[-%]\s*(chance|probability|likelihood)\s*(of|to)\s*(surviv|cur|remission|death)/i,
  /\byour (chances|odds) (of|are)\b/i,
  /\byou (will|won't) (recover|survive|beat this)/i,
  // Hindi — NO \b (see DIAGNOSIS_PATTERNS note)
  /(आप|तुम) (बच|ठीक हो|ठीक|मर) (जाएंगे|जाओगे|जाएँगे|सकते|जाएगा|जाओगी)/,
  /(आप|तुम) (ज़रूर|जरूर|पक्का|निश्चित) (ठीक|बच|जीवित)/,
  // Romanized Hindi
  /\b(aap|tum)\s+(theek|thik|bach)\s+(ho\s+)?(jaaoge|jaayenge|jaoge|jayenge|jaenge|jaaogi)\b/i,
];

// Dosage patterns (response MUST NOT contain these)
const DOSAGE_PATTERNS = [
  /\btake\s+\d+\s*(mg|ml|mcg|tablet|pill|capsule|dose)\b/i,
  /\b\d+\s*(mg|ml|mcg)\s*(once|twice|thrice|daily|per day|every)\b/i,
  /\bprescribe\s+\d+/i,
  /\brecommend(ed)?\s+(a\s+)?dose\s+of\s+\d+/i,
  /\b\d+\s*(mg|ml)\s*(of\s+)?(paracetamol|ibuprofen|morphine|cisplatin|doxorubicin|tamoxifen)/i,
];

// Inappropriate tone patterns
const INAPPROPRIATE_TONE_PATTERNS = [
  /\bjust\s+(relax|calm down|don'?t worry|chill)\b/i,
  /\bit'?s\s+(nothing|no big deal|not serious)\b/i,
  /\byou'?re\s+(fine|overreacting|being dramatic)\b/i,
  /\bstop\s+(worrying|panicking|overthinking)\b/i,
  /\b(be positive|think positive|stay positive|good vibes)\b/i,
  /\bGod'?s?\s+(will|plan|way)\b/i,
  /\beverything happens for a reason\b/i,
  // Hindi — NO \b (see DIAGNOSIS_PATTERNS note)
  /चिंता मत (करो|करना|करें|कीजिए|कर)/,
  /घबरा(ओ|ना|इए|इये)? मत/,
  /परेशान मत (हो|होइए|होना|हों)/,
  /(सब|सब कुछ) ठीक (हो जाएगा|हो जायेगा|है)/,
  // Romanized Hindi
  /\b(chinta|tension|fikar|pareshan)\s+mat\s+kar(o|na|en|iye)?\b/i,
  /\b(sab|sab kuch)\s+(theek|thik)\s+(ho jayega|ho jaega|hai)\b/i,
];

// Medical content indicators (to determine if citations are needed)
const MEDICAL_CONTENT_PATTERNS = [
  /\b(cancer|tumor|tumour|carcinoma|lymphoma|leukemia|malignant|benign|metastasis)\b/i,
  /\b(chemotherapy|radiation|surgery|biopsy|mastectomy|immunotherapy)\b/i,
  /\b(symptom|diagnosis|treatment|prognosis|staging|screening)\b/i,
  /\b(कैंसर|ट्यूमर|बायोप्सी|कीमो|रेडिएशन|सर्जरी)\b/i,
];

// The bot's own self-description mentions "cancer" but makes no medical claim,
// so it must NOT trip the medical-content → disclaimer/citation requirement.
const SELF_REFERENCE_PATTERNS = [
  /cancer\s+(care|information|support)\s+(navigation\s+)?(assistant|navigator|bot|helpline|companion)/gi,
  /(?:I am|I'?m)\s+suchi\b/gi,
];

function stripSelfReference(text: string): string {
  let t = text;
  for (const p of SELF_REFERENCE_PATTERNS) t = t.replace(p, " ");
  return t;
}

// ─── Service ───────────────────────────────────────────────────

@Injectable()
export class OutputVerifierService {
  private readonly logger = new Logger(OutputVerifierService.name);

  /**
   * Verify a response against policy checks.
   * Returns pass/fail with auto-fix if possible.
   */
  verify(
    content: string,
    evidenceChunks: EvidenceChunk[],
    checks: VerifyCheck[],
    userText: string
  ): VerificationResult {
    const violations: PolicyViolation[] = [];
    let fixedContent: string | null = null;
    let workingContent = content;

    for (const check of checks) {
      switch (check) {
        case "no_diagnosis":
          this.checkNoDiagnosis(workingContent, violations);
          break;
        case "no_prognosis":
          this.checkNoPrognosis(workingContent, violations);
          break;
        case "no_dosage":
          this.checkNoDosage(workingContent, violations);
          break;
        case "has_disclaimer": {
          const disclaimerResult = this.checkHasDisclaimer(workingContent, violations);
          if (disclaimerResult.fixed) {
            workingContent = disclaimerResult.content;
            fixedContent = workingContent;
          }
          break;
        }
        case "has_citations":
          this.checkHasCitations(workingContent, evidenceChunks, violations);
          break;
        case "appropriate_tone":
          this.checkAppropriateTone(workingContent, violations);
          break;
        case "no_ungrounded_entities":
          // This is handled by ResponseValidatorService (existing)
          // We add a lightweight check here for critical ungrounded claims
          this.checkNoUngroundedClaims(workingContent, evidenceChunks, violations);
          break;
      }
    }

    const hasCritical = violations.some(
      (v) => v.severity === "critical" && !v.autoFixed
    );
    const passed = !hasCritical;

    const summary = violations.length === 0
      ? "All checks passed"
      : violations
          .map(
            (v) =>
              `${v.severity}: ${v.check}${v.autoFixed ? " (auto-fixed)" : ""}`
          )
          .join("; ");

    if (violations.length > 0) {
      this.logger.log({
        event: "output_verification",
        passed,
        violationCount: violations.length,
        criticalCount: violations.filter((v) => v.severity === "critical").length,
        autoFixedCount: violations.filter((v) => v.autoFixed).length,
        checks: violations.map((v) => v.check),
      });
    }

    return {
      passed,
      violations,
      fixedContent: fixedContent !== content ? fixedContent : null,
      summary,
    };
  }

  /**
   * Quick verify for non-template responses (existing flow).
   * Runs essential checks only: no_diagnosis, no_prognosis, has_disclaimer.
   */
  quickVerify(
    content: string,
    evidenceChunks: EvidenceChunk[],
    userText: string
  ): VerificationResult {
    return this.verify(
      content,
      evidenceChunks,
      ["no_diagnosis", "no_prognosis", "no_dosage", "has_disclaimer"],
      userText
    );
  }

  // ─── Individual Check Implementations ────────────────────────

  private checkNoDiagnosis(
    content: string,
    violations: PolicyViolation[]
  ): void {
    const text = normalizeForMatch(content);
    for (const pattern of DIAGNOSIS_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        violations.push({
          check: "no_diagnosis",
          severity: "critical",
          detail: `Diagnostic language detected: "${match[0]}"`,
          autoFixed: false,
        });
        return; // One violation per check is enough
      }
    }
  }

  private checkNoPrognosis(
    content: string,
    violations: PolicyViolation[]
  ): void {
    const text = normalizeForMatch(content);
    for (const pattern of PROGNOSIS_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        violations.push({
          check: "no_prognosis",
          severity: "critical",
          detail: `Prognostic language detected: "${match[0]}"`,
          autoFixed: false,
        });
        return;
      }
    }
  }

  private checkNoDosage(
    content: string,
    violations: PolicyViolation[]
  ): void {
    const text = normalizeForMatch(content);
    for (const pattern of DOSAGE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        violations.push({
          check: "no_dosage",
          severity: "critical",
          detail: `Dosage recommendation detected: "${match[0]}"`,
          autoFixed: false,
        });
        return;
      }
    }
  }

  private checkHasDisclaimer(
    content: string,
    violations: PolicyViolation[]
  ): { fixed: boolean; content: string } {
    // Check if content has medical information that needs a disclaimer.
    // Strip the bot's self-description first so "cancer care navigation
    // assistant" in a greeting is not mistaken for a medical claim.
    const matchable = stripSelfReference(normalizeForMatch(content));
    const hasMedical = MEDICAL_CONTENT_PATTERNS.some((p) => p.test(matchable));
    if (!hasMedical) {
      return { fixed: false, content };
    }

    // Check for existing disclaimer using the disclaimer engine
    if (hasDisclaimer(content)) {
      return { fixed: false, content };
    }

    // Also check for common disclaimer patterns
    const hasCommonDisclaimer =
      /\b(not a diagnosis|educational purposes|consult.{0,30}(healthcare|doctor|physician|provider)|medical advice)\b/i.test(content);
    if (hasCommonDisclaimer) {
      return { fixed: false, content };
    }

    // Auto-fix: prepend disclaimer
    const disclaimer =
      "**Important:** This information is for general educational purposes and is not a diagnosis. Please consult with your healthcare provider for accurate, personalized medical information.\n\n";
    const fixedContent = disclaimer + content;

    violations.push({
      check: "has_disclaimer",
      severity: "warning",
      detail: "Medical content missing disclaimer — auto-added",
      autoFixed: true,
    });

    return { fixed: true, content: fixedContent };
  }

  private checkHasCitations(
    content: string,
    evidenceChunks: EvidenceChunk[],
    violations: PolicyViolation[]
  ): void {
    // Only check if content has medical information (ignore bot self-description)
    const matchable = stripSelfReference(normalizeForMatch(content));
    const hasMedical = MEDICAL_CONTENT_PATTERNS.some((p) => p.test(matchable));
    if (!hasMedical) return;

    // Check for citation markers
    const citationPattern = /\[citation:[^\]]+\]/g;
    const citations = content.match(citationPattern) || [];

    if (citations.length === 0 && evidenceChunks.length > 0) {
      violations.push({
        check: "has_citations",
        severity: "warning",
        detail: `Medical content has 0 citations but ${evidenceChunks.length} evidence chunks available`,
        autoFixed: false,
      });
    }
  }

  private checkAppropriateTone(
    content: string,
    violations: PolicyViolation[]
  ): void {
    const text = normalizeForMatch(content);
    for (const pattern of INAPPROPRIATE_TONE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        violations.push({
          check: "appropriate_tone",
          severity: "warning",
          detail: `Inappropriate tone detected: "${match[0]}"`,
          autoFixed: false,
        });
        return;
      }
    }
  }

  private checkNoUngroundedClaims(
    content: string,
    evidenceChunks: EvidenceChunk[],
    violations: PolicyViolation[]
  ): void {
    if (evidenceChunks.length === 0) return;

    // Lightweight check: look for specific percentage claims not in evidence
    const percentClaims = content.match(/\b\d{1,3}%\s*(of|chance|risk|survival|cure|response|rate)/gi);
    if (!percentClaims) return;

    const evidenceText = evidenceChunks
      .map((c) => c.content.toLowerCase())
      .join(" ");

    for (const claim of percentClaims) {
      // Extract the number
      const numMatch = claim.match(/\d+/);
      if (!numMatch) continue;
      const num = numMatch[0];

      // Check if this number appears in evidence
      if (!evidenceText.includes(num + "%") && !evidenceText.includes(num + " %")) {
        violations.push({
          check: "no_ungrounded_entities",
          severity: "warning",
          detail: `Percentage claim "${claim}" not found in evidence`,
          autoFixed: false,
        });
        return; // One is enough
      }
    }
  }
}
