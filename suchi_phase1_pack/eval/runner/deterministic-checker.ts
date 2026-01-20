import { DeterministicCheck, DeterministicCheckResult, GlobalConfig } from "../types";

export class DeterministicChecker {
  private globalConfig: GlobalConfig;

  constructor(globalConfig: GlobalConfig) {
    this.globalConfig = globalConfig;
  }

  /**
   * Run all deterministic checks for a response
   */
  runChecks(
    checks: DeterministicCheck[],
    responseText: string,
    questionCount: number,
    citations?: Array<{ docId: string; chunkId: string; position: number }>,
    citationConfidence?: string
  ): DeterministicCheckResult[] {
    return checks.map((check) => this.runCheck(check, responseText, questionCount, citations, citationConfidence));
  }

  /**
   * Run a single deterministic check
   */
  private runCheck(
    check: DeterministicCheck,
    responseText: string,
    questionCount: number,
    citations?: Array<{ docId: string; chunkId: string; position: number }>,
    citationConfidence?: string
  ): DeterministicCheckResult {
    try {
      let passed = false;
      let details: Record<string, any> = {};

      switch (check.type) {
        case "regex_absence": {
          passed = !this.checkRegexPresence(responseText, check.params.patterns_any);
          details = { matched: !passed };
          break;
        }

        case "regex_presence_any": {
          passed = this.checkRegexPresence(responseText, check.params.patterns_any);
          details = { matched: passed };
          break;
        }

        case "max_question_count": {
          const max = check.params.max || Infinity;
          passed = questionCount <= max;
          details = { questionCount, max };
          break;
        }

        case "section_presence_min": {
          const sections = this.detectSections(responseText, check.params.required_sections || []);
          const minPresent = check.params.min_present || 0;
          passed = sections.length >= minPresent;
          details = {
            sectionsFound: sections,
            requiredSections: check.params.required_sections,
            minPresent,
          };
          break;
        }

        case "citation_presence": {
          const minCount = check.params.min_count || 0;
          const citationCount = citations?.length || 0;
          passed = citationCount >= minCount;
          details = { citationCount, minCount, citations: citations || [] };
          break;
        }

        case "citation_confidence": {
          const minConfidence = check.params.min_confidence || "YELLOW";
          const confidenceLevels = ["RED", "YELLOW", "GREEN"];
          const currentLevel = citationConfidence || "RED";
          const currentIndex = confidenceLevels.indexOf(currentLevel);
          const minIndex = confidenceLevels.indexOf(minConfidence);
          passed = currentIndex >= minIndex;
          details = { currentConfidence: currentLevel, minConfidence, passed };
          break;
        }

        case "citation_format": {
          // Check if citations appear in response text in proper format
          const citationPattern = /\[citation:[^\]]+\]/gi;
          const citationMatches = responseText.match(citationPattern) || [];
          const hasValidFormat = citationMatches.length > 0;
          passed = hasValidFormat;
          details = { 
            citationMatchesFound: citationMatches.length,
            hasValidFormat,
            sampleMatches: citationMatches.slice(0, 3)
          };
          break;
        }

        default:
          passed = false;
          details = { error: `Unknown check type: ${check.type}` };
      }

      return {
        checkId: check.id,
        passed,
        required: check.required,
        details,
      };
    } catch (error: any) {
      return {
        checkId: check.id,
        passed: false,
        required: check.required,
        error: error.message,
      };
    }
  }

  /**
   * Convert PCRE-style (?i) patterns to JavaScript-compatible patterns
   * Removes (?i) prefix and uses the 'i' flag instead
   */
  private normalizePattern(pattern: string): string {
    // Remove (?i) prefix if present
    return pattern.replace(/^\(\?i\)/, "");
  }

  /**
   * Check if any regex pattern matches in the text
   */
  private checkRegexPresence(text: string, patterns: string[]): boolean {
    if (!patterns || patterns.length === 0) return false;

    for (const pattern of patterns) {
      try {
        const normalizedPattern = this.normalizePattern(pattern);
        const regex = new RegExp(normalizedPattern, "i");
        if (regex.test(text)) {
          return true;
        }
      } catch (error) {
        // Invalid regex pattern, skip
        console.warn(`Invalid regex pattern: ${pattern}`);
      }
    }

    return false;
  }

  /**
   * Detect sections in response text based on headers
   */
  private detectSections(text: string, requiredSections: string[]): string[] {
    const found: string[] = [];
    const textLower = text.toLowerCase();

    // Map section names to common header patterns
    const sectionPatterns: Record<string, RegExp[]> = {
      warning_signs: [
        /warning signs?/i,
        /signs? to watch/i,
        /symptoms? to watch/i,
        /red flags?/i,
      ],
      tests_to_expect: [
        /tests? (doctors?|clinicians?|may|will) (use|perform|order|do)/i,
        /diagnostic (tests?|methods?|procedures?)/i,
        /how doctors? confirm/i,
        /tests? to expect/i,
      ],
      when_to_seek_care_timeline: [
        /when to seek (care|medical attention|help)/i,
        /timeline/i,
        /when should/i,
        /seek (care|medical attention|help) (within|in|within)/i,
      ],
      questions_for_doctor: [
        /questions? (to ask|for|you should ask)/i,
        /ask (your |the )?doctor/i,
        /questions? (for|to) (your |the )?clinician/i,
      ],
      disclaimer: [
        /not (a |medical )?diagnosis/i,
        /can't diagnose/i,
        /cannot diagnose/i,
        /not medical advice/i,
        /see a (doctor|clinician)/i,
        /talk to a (doctor|clinician)/i,
      ],
      empathy_support: [
        /i understand/i,
        /i'm sorry/i,
        /that (sounds|must be|can be)/i,
        /i can (help|understand)/i,
      ],
      what_to_do_next: [
        /what to do (next|now)/i,
        /next steps?/i,
        /you should/i,
        /recommend/i,
      ],
      emergency_guidance: [
        /go to the (ER|emergency room)/i,
        /go to (an )?emergency department/i,
        /seek emergency care/i,
        /call an ambulance/i,
        /call emergency services/i,
        /emergency/i,
      ],
      caregiver_next_steps: [
        /how (can|to) (help|prepare|support)/i,
        /caregiver/i,
        /preparation/i,
        /what to bring/i,
      ],
      preparation_checklist: [
        /checklist/i,
        /prepare/i,
        /bring/i,
        /documents?/i,
        /medications?/i,
      ],
      explain_report_terms_plain_language: [
        /means?/i,
        /explain/i,
        /plain language/i,
        /in simple terms/i,
      ],
      confirmatory_steps: [
        /confirmatory/i,
        /next steps?/i,
        /what happens next/i,
        /further (tests?|evaluation)/i,
      ],
      staging_workup_overview: [
        /staging/i,
        /workup/i,
        /extent of (disease|cancer)/i,
      ],
      treatment_planning_overview: [
        /treatment (plan|options?|planning)/i,
        /next steps/i,
        /options?/i,
      ],
      common_symptoms: [
        /common symptoms?/i,
        /typical symptoms?/i,
        /symptoms? (of|include)/i,
        /signs? and symptoms?/i,
        /common signs?/i,
      ],
      early_warning_signs: [
        /early (warning )?signs?/i,
        /early symptoms?/i,
        /initial signs?/i,
        /first signs?/i,
        /early indicators?/i,
      ],
      later_signs: [
        /later signs?/i,
        /advanced symptoms?/i,
        /later stage symptoms?/i,
        /progressive signs?/i,
        /advanced signs?/i,
      ],
      diagnosis_tests: [
        /diagnosis (tests?|methods?|procedures?)/i,
        /tests? used to diagnose/i,
        /diagnostic (tests?|methods?|procedures?)/i,
        /how (is|are) (it|they) diagnosed/i,
        /diagnosis process/i,
      ],
      treatment_options: [
        /treatment options?/i,
        /treatment (methods?|modalities?|approaches?)/i,
        /treatment (types?|kinds?)/i,
        /options? for treatment/i,
        /treatment (strategies?|plans?)/i,
      ],
      side_effects_common: [
        /common side effects?/i,
        /typical side effects?/i,
        /side effects? (include|may include|can include)/i,
        /common (adverse )?effects?/i,
      ],
      side_effects_serious: [
        /serious side effects?/i,
        /severe side effects?/i,
        /serious (adverse )?effects?/i,
        /severe (adverse )?effects?/i,
        /serious complications?/i,
      ],
      when_to_contact_clinician: [
        /when to contact (your )?(clinician|doctor|healthcare provider)/i,
        /when to call (your )?(doctor|clinician)/i,
        /when to seek (medical )?(help|care|attention)/i,
        /contact (your )?(doctor|clinician) (if|when)/i,
        /call (your )?(doctor|clinician) (if|when)/i,
      ],
      red_flags: [
        /red flags?/i,
        /warning signs?/i,
        /urgent symptoms?/i,
        /emergency signs?/i,
        /seek urgent care/i,
      ],
      staging_basics: [
        /staging/i,
        /what (does|is) staging (mean|mean for)/i,
        /staging (system|process|means?)/i,
        /cancer staging/i,
        /stages? of (cancer|disease)/i,
      ],
      prognosis_factors: [
        /prognosis/i,
        /factors? (that|which) affect (prognosis|outcome)/i,
        /what affects (prognosis|outcome)/i,
        /prognosis factors?/i,
        /outcome factors?/i,
      ],
      visit_preparation: [
        /prepare (for|to)/i,
        /preparation (for|before)/i,
        /how to prepare/i,
        /what to bring/i,
        /preparing for (your|the) (visit|appointment)/i,
        /preparation checklist/i,
      ],
    };

    for (const section of requiredSections) {
      const patterns = sectionPatterns[section] || [];
      const foundPattern = patterns.some((pattern) => pattern.test(textLower));
      if (foundPattern) {
        found.push(section);
      }
    }

    return found;
  }

  /**
   * Count questions in text using global counting rules
   */
  countQuestions(text: string): number {
    const rules = this.globalConfig.counting_rules;
    let count = 0;

    // Count question marks
    const questionMarkMatches = text.match(/[?？]/g);
    if (questionMarkMatches) {
      count += questionMarkMatches.length;
    }

    // Count interrogatives
    for (const pattern of rules.interrogatives_patterns_any) {
      try {
        const normalizedPattern = this.normalizePattern(pattern);
        const regex = new RegExp(normalizedPattern, "gi");
        const matches = text.match(regex);
        if (matches) {
          count += matches.length;
        }
      } catch (error) {
        // Invalid pattern, skip
      }
    }

    return count;
  }
}

