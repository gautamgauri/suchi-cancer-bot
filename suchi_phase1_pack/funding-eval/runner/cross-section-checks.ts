/**
 * Deterministic cross-section checks for proposal quality evaluation.
 * These operate across all sections of a proposal, not on individual sections.
 */

export interface CrossSectionCheckResult {
  checkId: string;
  passed: boolean;
  detail: string;
}

interface ProposalSection {
  name: string;
  draftText?: string;
  [key: string]: unknown;
}

/**
 * Check that the proposal has at least `min` substantive sections.
 * A section is substantive if it has 50+ characters of draft text.
 */
export function checkMinSectionCount(
  sections: ProposalSection[],
  min: number,
): CrossSectionCheckResult {
  const substantive = sections.filter(
    (s) => (s.draftText?.trim().length ?? 0) >= 50,
  );
  return {
    checkId: "min_section_count",
    passed: substantive.length >= min,
    detail: `${substantive.length} substantive sections (need ${min})`,
  };
}

/**
 * Check that no sections contain error text (API failures that leaked through).
 */
export function checkNoErrorSections(
  sections: ProposalSection[],
): CrossSectionCheckResult {
  const errorPatterns = [
    /^Error:/i,
    /^Failed to generate/i,
    /Internal Server Error/i,
    /ECONNREFUSED/,
    /ETIMEDOUT/,
    /status code 5\d\d/i,
    /\{"error":/,
  ];

  const errorSections: string[] = [];
  for (const section of sections) {
    const text = section.draftText ?? "";
    for (const pattern of errorPatterns) {
      if (pattern.test(text)) {
        errorSections.push(section.name);
        break;
      }
    }
  }

  return {
    checkId: "no_error_sections",
    passed: errorSections.length === 0,
    detail:
      errorSections.length === 0
        ? "No error sections found"
        : `Error sections: ${errorSections.join(", ")}`,
  };
}

/**
 * Check that a specific number (e.g. beneficiary count) is consistent
 * across multiple sections. Extracts numbers near a keyword pattern
 * and checks that the same number appears in at least `minSections`.
 */
export function checkCrossSectionNumberConsistency(
  sections: ProposalSection[],
  field: string,
  minSections: number,
): CrossSectionCheckResult {
  // Build regex patterns for the field
  const fieldPatterns: Record<string, RegExp[]> = {
    beneficiary_count: [
      /(\d[\d,]*)\s*(?:children|students|beneficiaries|youth|participants|girls|boys)/gi,
      /(?:reach|serve|target|benefit|enroll)\s+(\d[\d,]*)/gi,
      /(\d[\d,]*)\s*(?:direct|indirect)\s*beneficiar/gi,
    ],
    budget_total: [
      /(?:total|overall|project)\s*(?:budget|cost|amount)\s*(?:of|:)?\s*(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?(?:\s*(?:lakhs?|crores?|lakh|cr))?)/gi,
      /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?(?:\s*(?:lakhs?|crores?|lakh|cr))?)\s*(?:total|overall|per\s*(?:year|annum))/gi,
    ],
  };

  const patterns = fieldPatterns[field];
  if (!patterns) {
    return {
      checkId: `cross_section_${field}_consistency`,
      passed: true,
      detail: `No patterns defined for field: ${field}`,
    };
  }

  // Extract numbers per section
  const numbersPerSection: Map<string, string[]> = new Map();
  for (const section of sections) {
    const text = section.draftText ?? "";
    const found: string[] = [];
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const num = match[1].replace(/,/g, "").trim();
        found.push(num);
      }
    }
    if (found.length > 0) {
      numbersPerSection.set(section.name, found);
    }
  }

  if (numbersPerSection.size < minSections) {
    return {
      checkId: `cross_section_${field}_consistency`,
      passed: false,
      detail: `${field} found in ${numbersPerSection.size} sections (need ${minSections})`,
    };
  }

  // Find the most common number across sections
  const allNumbers: string[] = [];
  for (const nums of numbersPerSection.values()) {
    allNumbers.push(...nums);
  }

  const frequency = new Map<string, number>();
  for (const n of allNumbers) {
    frequency.set(n, (frequency.get(n) ?? 0) + 1);
  }

  let mostCommon = "";
  let maxFreq = 0;
  for (const [num, freq] of frequency) {
    if (freq > maxFreq) {
      mostCommon = num;
      maxFreq = freq;
    }
  }

  // Check how many sections contain the most common number
  let sectionsWithConsistentNumber = 0;
  for (const [, nums] of numbersPerSection) {
    if (nums.includes(mostCommon)) {
      sectionsWithConsistentNumber++;
    }
  }

  const passed = sectionsWithConsistentNumber >= minSections;
  return {
    checkId: `cross_section_${field}_consistency`,
    passed,
    detail: `${field} "${mostCommon}" appears in ${sectionsWithConsistentNumber}/${numbersPerSection.size} sections (need ${minSections} consistent)`,
  };
}

/**
 * Check that a minimum ratio of sections use first-person voice
 * ("We", "Our") rather than third-person ("The organization").
 */
export function checkCrossSectionVoice(
  sections: ProposalSection[],
  minRatio: number,
): CrossSectionCheckResult {
  const firstPersonPattern = /\b(we|our|us)\b/i;
  const thirdPersonPattern =
    /\b(the organization|the NGO|the foundation|the team|the project)\b/i;

  let firstPersonCount = 0;
  let substantiveCount = 0;

  for (const section of sections) {
    const text = section.draftText ?? "";
    if (text.trim().length < 50) continue;
    substantiveCount++;

    const hasFirstPerson = firstPersonPattern.test(text);
    const hasThirdPerson = thirdPersonPattern.test(text);

    // Section uses first-person voice if it has first-person pronouns
    // and either doesn't have third-person or first-person dominates
    if (hasFirstPerson && !hasThirdPerson) {
      firstPersonCount++;
    } else if (hasFirstPerson && hasThirdPerson) {
      // Count occurrences
      const fpMatches = text.match(/\b(we|our|us)\b/gi) ?? [];
      const tpMatches =
        text.match(
          /\b(the organization|the NGO|the foundation|the team|the project)\b/gi,
        ) ?? [];
      if (fpMatches.length >= tpMatches.length) {
        firstPersonCount++;
      }
    }
  }

  const ratio = substantiveCount > 0 ? firstPersonCount / substantiveCount : 0;
  const passed = ratio >= minRatio;
  return {
    checkId: "first_person_voice",
    passed,
    detail: `${Math.round(ratio * 100)}% sections use first-person voice (${firstPersonCount}/${substantiveCount}, need ${Math.round(minRatio * 100)}%)`,
  };
}

/**
 * Check that a minimum ratio of sections use singular first-person voice
 * ("I", "my", "me") rather than org/plural voice ("we", "our", "the organization").
 * Used for fellowship/individual applications.
 */
export function checkCrossSectionVoiceSingular(
  sections: ProposalSection[],
  minRatio: number,
): CrossSectionCheckResult {
  const singularPattern = /\b(I|my|me|myself)\b/;
  const orgPluralPattern =
    /\b(the organization|the NGO|the foundation|we|our)\b/i;

  let singularCount = 0;
  let substantiveCount = 0;

  for (const section of sections) {
    const text = section.draftText ?? "";
    if (text.trim().length < 50) continue;
    substantiveCount++;

    const hasSingular = singularPattern.test(text);
    const hasOrgPlural = orgPluralPattern.test(text);

    if (hasSingular && !hasOrgPlural) {
      singularCount++;
    } else if (hasSingular && hasOrgPlural) {
      // Count occurrences — singular should dominate
      const spMatches = text.match(/\b(I|my|me|myself)\b/g) ?? [];
      const opMatches =
        text.match(
          /\b(the organization|the NGO|the foundation|we|our)\b/gi,
        ) ?? [];
      if (spMatches.length >= opMatches.length) {
        singularCount++;
      }
    }
  }

  const ratio = substantiveCount > 0 ? singularCount / substantiveCount : 0;
  const passed = ratio >= minRatio;
  return {
    checkId: "first_person_voice_singular",
    passed,
    detail: `${Math.round(ratio * 100)}% sections use singular first-person voice (${singularCount}/${substantiveCount}, need ${Math.round(minRatio * 100)}%)`,
  };
}

/**
 * Check word-limit compliance: sections with word limits should be within +50% of target.
 * Params: wordLimits — map of section name pattern to target word count.
 */
export function checkWordLimitCompliance(
  sections: ProposalSection[],
  wordLimits: Record<string, number>,
): CrossSectionCheckResult {
  const violations: string[] = [];
  let checked = 0;

  for (const section of sections) {
    const text = section.draftText ?? "";
    const name = section.name.toLowerCase();

    for (const [pattern, target] of Object.entries(wordLimits)) {
      if (name.includes(pattern.toLowerCase())) {
        checked++;
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        const maxAllowed = Math.ceil(target * 1.5);
        if (wordCount > maxAllowed) {
          violations.push(
            `"${section.name}": ${wordCount} words (limit ${target}, max ${maxAllowed})`,
          );
        }
        break;
      }
    }
  }

  return {
    checkId: "word_limit_compliance",
    passed: violations.length === 0,
    detail:
      violations.length === 0
        ? `${checked} sections checked, all within word limits`
        : `Word limit exceeded: ${violations.join("; ")}`,
  };
}

/**
 * Check that no sections start with an org name or use "we" as sentence subject.
 * Used for fellowship/individual applications to catch org-voice leakage.
 */
export function checkNoOrgVoiceLeakage(
  sections: ProposalSection[],
  orgNames: string[],
): CrossSectionCheckResult {
  const leaks: string[] = [];

  for (const section of sections) {
    const text = (section.draftText ?? "").trim();
    if (text.length < 50) continue;

    // Check if section starts with an org name
    for (const org of orgNames) {
      if (text.toLowerCase().startsWith(org.toLowerCase())) {
        leaks.push(`"${section.name}" starts with "${org}"`);
        break;
      }
    }

    // Check for "We" as sentence subject (start of sentence)
    const weSubjectPattern = /(?:^|\.\s+)We\s+(?:have|are|will|would|plan|aim|seek|intend|propose|believe)/gm;
    const weMatches = text.match(weSubjectPattern);
    if (weMatches && weMatches.length > 0) {
      leaks.push(
        `"${section.name}" uses "We" as subject (${weMatches.length}x)`,
      );
    }
  }

  return {
    checkId: "no_org_voice_leakage",
    passed: leaks.length === 0,
    detail:
      leaks.length === 0
        ? "No org-voice leakage detected"
        : `Org-voice leakage: ${leaks.join("; ")}`,
  };
}

/**
 * Check that no two sections share more than `maxOverlap` of their 3-gram tokens.
 * Detects repetition of the same content blocks across sections.
 */
export function checkCrossSectionDeduplication(
  sections: ProposalSection[],
  maxOverlap: number = 0.30,
): CrossSectionCheckResult {
  const substantive = sections.filter(
    (s) => (s.draftText?.trim().length ?? 0) >= 50,
  );

  if (substantive.length < 2) {
    return {
      checkId: "cross_section_deduplication",
      passed: true,
      detail: "Fewer than 2 substantive sections — skipped",
    };
  }

  // Extract 3-grams for each section
  function extractNGrams(text: string, n: number): Set<string> {
    const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
    const grams = new Set<string>();
    for (let i = 0; i <= words.length - n; i++) {
      grams.add(words.slice(i, i + n).join(" "));
    }
    return grams;
  }

  const sectionGrams = substantive.map((s) => ({
    name: s.name,
    grams: extractNGrams(s.draftText ?? "", 3),
  }));

  const violations: string[] = [];

  for (let i = 0; i < sectionGrams.length; i++) {
    for (let j = i + 1; j < sectionGrams.length; j++) {
      const a = sectionGrams[i];
      const b = sectionGrams[j];
      const smaller = Math.min(a.grams.size, b.grams.size);
      if (smaller === 0) continue;

      let overlap = 0;
      for (const gram of a.grams) {
        if (b.grams.has(gram)) overlap++;
      }

      const ratio = overlap / smaller;
      if (ratio > maxOverlap) {
        violations.push(
          `"${a.name}" ↔ "${b.name}": ${Math.round(ratio * 100)}% 3-gram overlap`,
        );
      }
    }
  }

  return {
    checkId: "cross_section_deduplication",
    passed: violations.length === 0,
    detail:
      violations.length === 0
        ? `${substantive.length} sections checked, all below ${Math.round(maxOverlap * 100)}% overlap`
        : `Excessive overlap: ${violations.join("; ")}`,
  };
}

/**
 * Check that no sections contain budget/financial language.
 * Used for fellowship applications where budget language is inappropriate.
 */
export function checkNoBudgetLanguage(
  sections: ProposalSection[],
): CrossSectionCheckResult {
  const budgetPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bINR\b/, label: "INR" },
    { pattern: /₹/, label: "₹" },
    { pattern: /Rs\.?\s*\d/, label: "Rs." },
    { pattern: /\bbudget\b/i, label: "budget" },
    { pattern: /fund allocation/i, label: "fund allocation" },
    { pattern: /cost per beneficiary/i, label: "cost per beneficiary" },
    { pattern: /\blakh\b/i, label: "lakh" },
    { pattern: /\bcrore\b/i, label: "crore" },
    { pattern: /\bline-item\b/i, label: "line-item" },
    { pattern: /budget breakdown/i, label: "budget breakdown" },
    { pattern: /budget justification/i, label: "budget justification" },
    { pattern: /grand total/i, label: "grand total" },
    { pattern: /fund utilization/i, label: "fund utilization" },
  ];

  const violations: string[] = [];

  for (const section of sections) {
    const text = section.draftText ?? "";
    if (text.trim().length < 50) continue;

    for (const { pattern, label } of budgetPatterns) {
      if (pattern.test(text)) {
        violations.push(`"${section.name}" contains "${label}"`);
        break; // One violation per section is enough
      }
    }
  }

  return {
    checkId: "no_budget_language",
    passed: violations.length === 0,
    detail:
      violations.length === 0
        ? "No budget/financial language found"
        : `Budget language found: ${violations.join("; ")}`,
  };
}

/**
 * Check for leftover template artifacts: {{MISSING:...}}, empty [citation:],
 * nested/malformed citations, <<PLACEHOLDER>>, [PLACEHOLDER].
 */
export function checkNoRawTags(
  sections: ProposalSection[],
): CrossSectionCheckResult {
  const tagPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\{\{MISSING:[^}]*\}\}/, label: "{{MISSING:...}}" },
    { pattern: /\[citation:\s*\]/, label: "empty [citation:]" },
    { pattern: /\[citation:[^\]]*\[citation:/, label: "nested citation" },
    { pattern: /<<PLACEHOLDER>>/, label: "<<PLACEHOLDER>>" },
    { pattern: /\[PLACEHOLDER\]/i, label: "[PLACEHOLDER]" },
  ];

  const violations: string[] = [];

  for (const section of sections) {
    const text = section.draftText ?? "";
    if (text.trim().length < 10) continue;

    for (const { pattern, label } of tagPatterns) {
      if (pattern.test(text)) {
        violations.push(`"${section.name}" has ${label}`);
      }
    }
  }

  return {
    checkId: "no_raw_tags",
    passed: violations.length === 0,
    detail:
      violations.length === 0
        ? "No template artifacts found"
        : `Template artifacts: ${violations.join("; ")}`,
  };
}

/**
 * Count hollow phrases across the entire proposal text.
 */
export function checkHollowPhraseCount(
  sections: ProposalSection[],
  patterns: string[],
  maxCount: number,
): CrossSectionCheckResult {
  const allText = sections.map((s) => s.draftText ?? "").join("\n\n");
  let total = 0;
  const found: string[] = [];

  for (const phrase of patterns) {
    const regex = new RegExp(phrase, "gi");
    const matches = allText.match(regex);
    if (matches) {
      total += matches.length;
      found.push(`"${phrase}" (${matches.length})`);
    }
  }

  return {
    checkId: "low_hollow_phrases",
    passed: total <= maxCount,
    detail:
      total === 0
        ? "No hollow phrases found"
        : `${total} hollow phrases found (max ${maxCount}): ${found.join(", ")}`,
  };
}
