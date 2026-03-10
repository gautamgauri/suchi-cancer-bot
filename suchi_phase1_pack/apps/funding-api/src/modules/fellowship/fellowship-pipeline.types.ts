/**
 * Types for the strategy-first fellowship pipeline.
 * Stages A–E produce these intermediate artifacts.
 */

// Stage A: Opportunity Interpreter output
export interface FellowshipInterpretation {
  intellectualCore: string;
  whatGoodLooksLike: string;
  keyThemes: string[];
  antiPatterns: string[];
  selectionLens: string;
}

// Stage B: Narrative Synthesizer output
export interface ApplicantNarrative {
  originMoment: string;
  intellectualJourney: string;
  leadershipExamples: Array<{ scene: string; demonstrates: string }>;
  frameworksUsed: string[];
  tensionsNavigated: string[];
  uniqueAngle: string;
  numericFacts: Array<{ claim: string; source: string }>;
}

// Stage C: Bridge Selector output
export interface FellowshipBridge {
  thesis: string;
  bridgeType: string;
  applicantBringsToFellowship: string;
  fellowshipBringsToApplicant: string;
  keyNarrativeThreads: string[];
  sectionAnchors: Record<string, string>;
}

// Stage D: Section Planner output
export interface SectionPlan {
  sections: Array<{
    name: string;
    thesis: string;
    assignedStories: string[];
    assignedFacts: string[];
    retrievalHints: string[];
    openingMove: string;
    mustAvoidFrom: string[];
    wordBudget: number;
  }>;
}

// Stage E: Critic Review output
export interface FellowshipCriticResult {
  overallScore: number;
  dimensions: Array<{
    dimension: string;
    score: number;
    finding: string;
    fix?: string;
  }>;
  crossSectionIssues: string[];
  tagViolations: string[];
}
