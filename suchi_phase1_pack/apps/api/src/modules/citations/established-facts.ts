/**
 * Established Medical Facts Registry
 *
 * These are facts with overwhelming scientific consensus that should NOT
 * receive "limited source material" disclaimers even with only 1 citation.
 *
 * Criteria for inclusion:
 * - Supported by major health organizations (NCI, WHO, CDC, IARC)
 * - Part of standard medical education
 * - No meaningful scientific controversy
 * - Established through decades of research
 *
 * IMPORTANT: This is a conservative list. Only add facts that are truly
 * beyond scientific dispute. When in doubt, leave it out.
 */

export interface EstablishedFact {
  patterns: RegExp[];
  category: 'causation' | 'risk_factor' | 'screening' | 'prevention';
  description: string;
}

export const ESTABLISHED_FACTS: EstablishedFact[] = [
  // Smoking and cancer - overwhelming consensus since 1964 Surgeon General report
  {
    patterns: [
      /smoking\s+(causes?|leads?\s+to|increases?\s+risk\s+of)\s+(lung\s+)?cancer/i,
      /tobacco\s+(causes?|leads?\s+to|increases?\s+risk\s+of)\s+cancer/i,
      /cigarettes?\s+(cause|increase)\s+(risk\s+of\s+)?cancer/i,
      /smoking\s+is\s+(a\s+)?(major\s+)?(cause|risk\s+factor)/i,
      /tobacco\s+use\s+(is\s+)?(a\s+)?risk\s+factor/i,
      /smoking\s+(and|&)\s+cancer/i,
    ],
    category: 'causation',
    description: 'Smoking causes cancer - established since 1964',
  },
  // Smoking causes multiple specific cancers
  {
    patterns: [
      /smoking\s+(causes?|is\s+linked\s+to)\s+(lung|bladder|pancreatic|kidney|esophageal|stomach)/i,
      /tobacco\s+(causes?|is\s+linked\s+to)\s+(lung|bladder|pancreatic|kidney)/i,
      /(lung|bladder|pancreatic)\s+cancer\s+(is\s+)?caused\s+by\s+(smoking|tobacco)/i,
    ],
    category: 'causation',
    description: 'Smoking causes specific cancer types',
  },
  // HPV and cancer
  {
    patterns: [
      /hpv\s+(causes?|leads?\s+to|is\s+linked\s+to)\s+(cervical|throat|head\s+and\s+neck|oropharyngeal)\s+cancer/i,
      /human\s+papillomavirus\s+(causes?|is\s+linked\s+to)\s+cancer/i,
      /cervical\s+cancer\s+(is\s+)?caused\s+by\s+hpv/i,
    ],
    category: 'causation',
    description: 'HPV causes cervical and other cancers',
  },
  // Obesity and cancer risk
  {
    patterns: [
      /obesity\s+(increases?\s+risk|is\s+(a\s+)?risk\s+factor)\s+(of|for)\s+cancer/i,
      /overweight\s+(increases?\s+risk|is\s+associated\s+with)\s+cancer/i,
      /body\s+weight\s+(affects?|impacts?|increases?)\s+cancer\s+risk/i,
    ],
    category: 'risk_factor',
    description: 'Obesity increases cancer risk',
  },
  // UV/sun exposure and skin cancer
  {
    patterns: [
      /sun\s+exposure\s+(causes?|increases?\s+risk\s+of)\s+(skin\s+)?cancer/i,
      /uv\s+(radiation|light|rays?)\s+(causes?|increases?)\s+(skin\s+)?cancer/i,
      /melanoma\s+(is\s+)?caused\s+by\s+(sun|uv)/i,
    ],
    category: 'causation',
    description: 'UV exposure causes skin cancer',
  },
  // Common screening facts
  {
    patterns: [
      /mammograms?\s+(detect|screen\s+for|can\s+find)\s+breast\s+cancer/i,
      /colonoscopy\s+(detects?|screens?\s+for|can\s+find)\s+(colorectal|colon)\s+cancer/i,
      /pap\s+(test|smear)\s+(detects?|screens?\s+for)\s+cervical\s+cancer/i,
      /psa\s+test\s+(screens?\s+for|detects?)\s+prostate\s+cancer/i,
    ],
    category: 'screening',
    description: 'Standard cancer screening methods',
  },
];

/**
 * Check if response text contains well-established medical facts
 *
 * @param responseText The LLM-generated response
 * @param query The original user query
 * @returns Whether the response is stating established facts
 */
export function containsEstablishedFact(
  responseText: string,
  query: string,
): {
  isEstablished: boolean;
  matchedFact?: EstablishedFact;
} {
  const combinedText = `${query} ${responseText}`;

  for (const fact of ESTABLISHED_FACTS) {
    for (const pattern of fact.patterns) {
      if (pattern.test(combinedText)) {
        return { isEstablished: true, matchedFact: fact };
      }
    }
  }

  return { isEstablished: false };
}
