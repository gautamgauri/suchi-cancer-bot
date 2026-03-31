/**
 * Eval Optimizer — "eval-on-eval" autoresearch
 *
 * Analyzes the quality of the eval suite itself (not the bot's answers)
 * and proposes improvements to test cases, keyword checks, and rubrics.
 *
 * Three phases:
 *   1. Analyze — stability, discriminative power, coverage gaps, keyword brittleness
 *   2. Propose — LLM-generated improvements (new cases, relaxed keywords, stricter checks)
 *   3. Generate — output proposed YAML cases and a quality report
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as yaml from "js-yaml";
import OpenAI from "openai";
import { loadConfig } from "../config/loader";

// ── Types ──────────────────────────────────────────────────────────────────

export interface EvalOptimizerConfig {
  /** Paths to all eval case YAML files to analyze */
  casePaths: string[];
  /** Path to rubrics JSON */
  rubricsPath: string;
  /** Paths to recent eval report JSON files */
  reportPaths: string[];
  /** Output directory for the optimizer report and proposed YAML */
  outputDir: string;
  /** Dry run: analyze only, do not call LLM for proposals */
  dryRun: boolean;
}

/** Per-case stability & quality analysis */
export interface CaseAnalysis {
  caseId: string;
  source: string; // which YAML file
  cancer: string;
  intent: string;
  /** How many times this case appeared across reports */
  runCount: number;
  /** How many times it passed */
  passCount: number;
  /** Pass rate across runs (0-1) */
  passRate: number;
  /** Stability verdict */
  stability: "always_pass" | "always_fail" | "flaky" | "discriminative";
  /** Keyword brittleness findings */
  keywordBrittleness: KeywordBrittlenessEntry[];
}

export interface KeywordBrittlenessEntry {
  /** The keyword required by must_mention or must_mention_tests */
  required: string;
  /** Near-miss variants found in responses but not matching */
  nearMisses: string[];
  /** Whether the keyword ever caused a false failure */
  causedFailure: boolean;
}

export interface CoverageGap {
  dimension: string; // "cancer", "intent", "language", "patient_state"
  value: string;
  currentCount: number;
  recommendation: string;
}

export interface EvalQualityReport {
  timestamp: string;
  totalCases: number;
  caseAnalyses: CaseAnalysis[];
  stabilityDistribution: {
    always_pass: number;
    always_fail: number;
    flaky: number;
    discriminative: number;
  };
  coverageGaps: CoverageGap[];
  brittleKeywords: KeywordBrittlenessEntry[];
  proposals: EvalProposal[];
}

export interface EvalProposal {
  type: "new_case" | "relax_keyword" | "strict_check" | "better_coverage";
  priority: "high" | "medium" | "low";
  description: string;
  /** For new_case: YAML snippet. For relax_keyword: suggested change. */
  suggestion: string;
  /** Which existing case this relates to (if any) */
  relatedCaseId?: string;
}

// ── Near-miss keyword map ──────────────────────────────────────────────────

const KNOWN_SYNONYMS: Record<string, string[]> = {
  mammogram: ["mammography", "mammographic"],
  mammography: ["mammogram", "mammographic"],
  biopsy: ["biopsies", "bioptic"],
  colonoscopy: ["colonoscopies", "colonoscopic"],
  ultrasound: ["ultrasonography", "sonography", "USG"],
  "chest X-ray": ["chest x-ray", "chest xray", "CXR"],
  CT: ["CT scan", "CAT scan", "computed tomography"],
  "CT scan": ["CT", "CAT scan", "computed tomography"],
  "PET-CT": ["PET/CT", "PET CT", "PET scan"],
  HPV: ["human papillomavirus", "papillomavirus"],
  vaccine: ["vaccination", "immunization"],
  screening: ["screen", "screened"],
  oncologist: ["oncology", "cancer specialist", "cancer doctor"],
  doctor: ["physician", "clinician", "healthcare provider"],
  treatment: ["therapy", "intervention"],
  cough: ["coughing"],
  nausea: ["nauseous", "nauseated"],
  "hair loss": ["alopecia", "losing hair"],
  fatigue: ["tiredness", "exhaustion", "tired"],
  "shortness of breath": ["breathlessness", "dyspnea", "difficulty breathing"],
  emergency: ["urgent", "immediately", "right away"],
  ER: ["emergency room", "emergency department", "A&E"],
  ambulance: ["emergency services", "paramedics"],
};

// ── Main entry ─────────────────────────────────────────────────────────────

export async function runEvalOptimizer(config: EvalOptimizerConfig): Promise<void> {
  console.log("\n=== Suchi Eval Optimizer ===");
  console.log(`Case files: ${config.casePaths.length}`);
  console.log(`Report files: ${config.reportPaths.length}`);
  console.log(`Dry run: ${config.dryRun}`);
  console.log("");

  // Phase 1: Analyze
  console.log("Phase 1: Analyzing current eval quality...\n");
  const allCases = await loadAllCases(config.casePaths);
  const reports = await loadReports(config.reportPaths);

  const caseAnalyses = analyzeCaseStability(allCases, reports);
  const coverageGaps = analyzeCoverageGaps(allCases);
  const brittleKeywords = analyzeKeywordBrittleness(allCases, reports);

  const stabilityDist = {
    always_pass: caseAnalyses.filter((c) => c.stability === "always_pass").length,
    always_fail: caseAnalyses.filter((c) => c.stability === "always_fail").length,
    flaky: caseAnalyses.filter((c) => c.stability === "flaky").length,
    discriminative: caseAnalyses.filter((c) => c.stability === "discriminative").length,
  };

  console.log("Stability distribution:");
  console.log(`  Always pass:    ${stabilityDist.always_pass}`);
  console.log(`  Always fail:    ${stabilityDist.always_fail}`);
  console.log(`  Flaky:          ${stabilityDist.flaky}`);
  console.log(`  Discriminative: ${stabilityDist.discriminative}`);

  console.log(`\nCoverage gaps found: ${coverageGaps.length}`);
  for (const gap of coverageGaps) {
    console.log(`  [${gap.dimension}] ${gap.value}: ${gap.recommendation}`);
  }

  console.log(`\nBrittle keywords found: ${brittleKeywords.length}`);
  for (const bk of brittleKeywords) {
    console.log(`  "${bk.required}" -> near-misses: ${bk.nearMisses.join(", ") || "(none known)"} | caused failure: ${bk.causedFailure}`);
  }

  // Phase 2: Propose improvements
  let proposals: EvalProposal[] = [];
  if (!config.dryRun) {
    console.log("\nPhase 2: Generating improvement proposals via LLM...\n");
    proposals = await generateProposals(caseAnalyses, coverageGaps, brittleKeywords, allCases);
  } else {
    console.log("\nPhase 2: [DRY RUN] Generating rule-based proposals only...\n");
    proposals = generateRuleBasedProposals(caseAnalyses, coverageGaps, brittleKeywords);
  }

  console.log(`Generated ${proposals.length} proposal(s):`);
  for (const p of proposals) {
    console.log(`  [${p.priority}] ${p.type}: ${p.description}`);
  }

  // Phase 3: Output
  console.log("\nPhase 3: Writing output...\n");
  const report: EvalQualityReport = {
    timestamp: new Date().toISOString(),
    totalCases: allCases.length,
    caseAnalyses,
    stabilityDistribution: stabilityDist,
    coverageGaps,
    brittleKeywords,
    proposals,
  };

  await fs.mkdir(config.outputDir, { recursive: true });

  const reportPath = path.join(config.outputDir, "eval-quality-report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Quality report saved: ${reportPath}`);

  // Write proposed new cases as YAML if any
  const newCaseProposals = proposals.filter((p) => p.type === "new_case");
  if (newCaseProposals.length > 0) {
    const proposedYaml = generateProposedCasesYaml(newCaseProposals);
    const yamlPath = path.join(config.outputDir, "proposed-new-cases.yaml");
    await fs.writeFile(yamlPath, proposedYaml, "utf-8");
    console.log(`Proposed new cases YAML: ${yamlPath}`);
  }

  // Write human-readable summary
  const summaryPath = path.join(config.outputDir, "eval-quality-summary.txt");
  await fs.writeFile(summaryPath, formatSummaryText(report), "utf-8");
  console.log(`Human-readable summary: ${summaryPath}`);

  console.log("\nEval Optimizer complete.");
}

// ── Phase 1: Analysis functions ────────────────────────────────────────────

interface LoadedCase {
  id: string;
  source: string;
  cancer: string;
  intent: string;
  language?: string;
  channel?: string;
  userMessages: string[];
  mustMention?: string[];
  mustMentionAny?: string[];
  mustMentionTests?: string[];
  mustNot?: string[];
  raw: any;
}

async function loadAllCases(casePaths: string[]): Promise<LoadedCase[]> {
  const all: LoadedCase[] = [];

  for (const casePath of casePaths) {
    try {
      const content = await fs.readFile(casePath, "utf-8");
      const parsed = yaml.load(content) as any;
      if (!parsed?.cases) continue;

      for (const c of parsed.cases) {
        all.push({
          id: c.id,
          source: casePath,
          cancer: c.cancer || "general",
          intent: c.intent || "unknown",
          language: c.language || c.channel === "voice" ? "en" : (c.language || "en"),
          channel: c.channel || "text",
          userMessages: c.user_messages || (c.voice_input ? [c.voice_input] : []),
          mustMention: c.expectations?.must_mention || [],
          mustMentionAny: c.expectations?.must_mention_any || c.expectations?.must_include_any || [],
          mustMentionTests: c.expectations?.must_mention_tests || [],
          mustNot: c.expectations?.must_not || [],
          raw: c,
        });
      }
    } catch (err: any) {
      console.warn(`  Warning: could not load ${casePath}: ${err.message}`);
    }
  }

  return all;
}

interface LoadedReport {
  source: string;
  results: Array<{
    testCaseId: string;
    passed: boolean;
    score: number;
    responseText: string;
    deterministicResults?: Array<{ checkId: string; passed: boolean; details?: any }>;
    llmJudgeResults?: Array<{ checkId: string; passed: boolean }>;
  }>;
}

async function loadReports(reportPaths: string[]): Promise<LoadedReport[]> {
  const reports: LoadedReport[] = [];

  for (const rp of reportPaths) {
    try {
      const content = await fs.readFile(rp, "utf-8");
      const parsed = JSON.parse(content);

      // Handle both standard eval reports and voice transcript reports
      if (parsed.results) {
        reports.push({ source: rp, results: parsed.results });
      } else if (parsed.transcripts) {
        // Voice transcript format
        const results = parsed.transcripts.map((t: any) => ({
          testCaseId: t.caseId,
          passed: t.passed,
          score: t.passed ? 1 : 0,
          responseText: t.responseText || "",
          deterministicResults: [],
          llmJudgeResults: t.checks?.llmJudge?.results?.map((r: any) => ({
            checkId: r.checkId,
            passed: r.passed,
          })) || [],
        }));
        reports.push({ source: rp, results });
      }
    } catch (err: any) {
      console.warn(`  Warning: could not load report ${rp}: ${err.message}`);
    }
  }

  return reports;
}

function analyzeCaseStability(
  cases: LoadedCase[],
  reports: LoadedReport[],
): CaseAnalysis[] {
  const analyses: CaseAnalysis[] = [];

  for (const tc of cases) {
    let runCount = 0;
    let passCount = 0;

    for (const report of reports) {
      const match = report.results.find((r) => r.testCaseId === tc.id);
      if (match) {
        runCount++;
        if (match.passed) passCount++;
      }
    }

    const passRate = runCount > 0 ? passCount / runCount : -1; // -1 = never run
    let stability: CaseAnalysis["stability"];

    if (runCount === 0) {
      stability = "discriminative"; // No data, assume OK
    } else if (passRate === 1) {
      stability = "always_pass";
    } else if (passRate === 0) {
      stability = "always_fail";
    } else if (passRate > 0.3 && passRate < 0.7) {
      stability = "flaky";
    } else {
      stability = "discriminative";
    }

    analyses.push({
      caseId: tc.id,
      source: tc.source,
      cancer: tc.cancer,
      intent: tc.intent,
      runCount,
      passCount,
      passRate: runCount > 0 ? passRate : -1,
      stability,
      keywordBrittleness: [],
    });
  }

  return analyses;
}

function analyzeCoverageGaps(cases: LoadedCase[]): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  // Cancer type coverage
  const cancerCounts = new Map<string, number>();
  for (const c of cases) {
    cancerCounts.set(c.cancer, (cancerCounts.get(c.cancer) || 0) + 1);
  }

  const EXPECTED_CANCERS = [
    "lung", "breast", "cervical", "colorectal", "prostate", "oral",
    "pancreatic", "stomach", "liver", "ovarian", "leukemia", "lymphoma",
    "thyroid", "bladder", "kidney",
  ];

  for (const cancer of EXPECTED_CANCERS) {
    const count = cancerCounts.get(cancer) || 0;
    if (count === 0) {
      gaps.push({
        dimension: "cancer",
        value: cancer,
        currentCount: 0,
        recommendation: `No test cases for ${cancer} cancer. Add at least 2 cases (informational + symptomatic).`,
      });
    } else if (count < 2) {
      gaps.push({
        dimension: "cancer",
        value: cancer,
        currentCount: count,
        recommendation: `Only ${count} test case(s) for ${cancer} cancer. Consider adding more intents.`,
      });
    }
  }

  // Intent coverage
  const intentCounts = new Map<string, number>();
  for (const c of cases) {
    intentCounts.set(c.intent, (intentCounts.get(c.intent) || 0) + 1);
  }

  const EXPECTED_INTENTS = [
    "INFORMATIONAL_GENERAL", "SYMPTOMATIC_PATIENT", "CAREGIVER_NAVIGATION",
    "POST_DIAGNOSIS_OR_SUSPECTED", "RED_FLAG_URGENT", "SIDE_EFFECTS_GENERAL",
    "TREATMENT_DOSAGE", "CRISIS", "MISINFORMATION", "REPORT_INTERPRETATION",
  ];

  for (const intent of EXPECTED_INTENTS) {
    const count = intentCounts.get(intent) || 0;
    if (count === 0) {
      gaps.push({
        dimension: "intent",
        value: intent,
        currentCount: 0,
        recommendation: `No test cases for intent ${intent}. This is a critical gap.`,
      });
    } else if (count < 2) {
      gaps.push({
        dimension: "intent",
        value: intent,
        currentCount: count,
        recommendation: `Only ${count} test case(s) for intent ${intent}.`,
      });
    }
  }

  // Patient states not covered
  const UNCOVERED_STATES = [
    { value: "second_opinion", label: "Second opinion queries" },
    { value: "financial_assistance", label: "Financial assistance / insurance queries" },
    { value: "clinical_trials", label: "Clinical trial eligibility questions" },
    { value: "survivorship", label: "Post-treatment survivorship concerns" },
    { value: "palliative_care", label: "Palliative / hospice care questions" },
    { value: "hindi_symptomatic", label: "Hindi-language symptomatic queries" },
    { value: "multi_turn", label: "Multi-turn follow-up conversations" },
  ];

  // Check if any existing cases cover these
  for (const state of UNCOVERED_STATES) {
    const hasCase = cases.some((c) => {
      const msgs = c.userMessages.join(" ").toLowerCase();
      switch (state.value) {
        case "second_opinion": return msgs.includes("second opinion");
        case "financial_assistance": return msgs.includes("financial") || msgs.includes("insurance") || msgs.includes("cost");
        case "clinical_trials": return msgs.includes("clinical trial");
        case "survivorship": return msgs.includes("survivor") || msgs.includes("remission") || msgs.includes("after treatment");
        case "palliative_care": return msgs.includes("palliative") || msgs.includes("hospice") || msgs.includes("end of life");
        case "hindi_symptomatic": return c.language === "hi" && c.intent === "SYMPTOMATIC_PATIENT";
        case "multi_turn": return c.userMessages.length > 1;
        default: return false;
      }
    });

    if (!hasCase) {
      gaps.push({
        dimension: "patient_state",
        value: state.value,
        currentCount: 0,
        recommendation: `No test cases for ${state.label}. Consider adding.`,
      });
    }
  }

  return gaps;
}

function analyzeKeywordBrittleness(
  cases: LoadedCase[],
  reports: LoadedReport[],
): KeywordBrittlenessEntry[] {
  const brittleEntries: KeywordBrittlenessEntry[] = [];
  const seen = new Set<string>();

  for (const tc of cases) {
    const allKeywords = [
      ...(tc.mustMention || []),
      ...(tc.mustMentionTests || []),
    ];

    for (const keyword of allKeywords) {
      if (seen.has(keyword)) continue;

      const synonyms = KNOWN_SYNONYMS[keyword] || [];
      if (synonyms.length === 0) continue;

      // Check if any report response contains a synonym but not the exact keyword
      let causedFailure = false;

      for (const report of reports) {
        const match = report.results.find((r) => r.testCaseId === tc.id);
        if (!match) continue;

        const responseLower = match.responseText.toLowerCase();
        const hasExact = responseLower.includes(keyword.toLowerCase());
        const hasSynonym = synonyms.some((s) => responseLower.includes(s.toLowerCase()));

        if (!hasExact && hasSynonym && !match.passed) {
          causedFailure = true;
        }
      }

      if (synonyms.length > 0) {
        brittleEntries.push({
          required: keyword,
          nearMisses: synonyms,
          causedFailure,
        });
        seen.add(keyword);
      }
    }
  }

  return brittleEntries;
}

// ── Phase 2: Proposal generation ───────────────────────────────────────────

function generateRuleBasedProposals(
  analyses: CaseAnalysis[],
  gaps: CoverageGap[],
  brittle: KeywordBrittlenessEntry[],
): EvalProposal[] {
  const proposals: EvalProposal[] = [];

  // Propose relaxed keywords for brittle checks
  for (const bk of brittle) {
    if (bk.causedFailure) {
      proposals.push({
        type: "relax_keyword",
        priority: "high",
        description: `Keyword "${bk.required}" is brittle. Synonyms ${bk.nearMisses.map((s) => `"${s}"`).join(", ")} appear in responses but don't match. Switch to must_mention_any or use regex pattern.`,
        suggestion: `must_mention_any: [${[bk.required, ...bk.nearMisses].map((s) => `"${s}"`).join(", ")}]`,
        relatedCaseId: undefined,
      });
    }
  }

  // Propose new cases for coverage gaps
  for (const gap of gaps) {
    if (gap.currentCount === 0) {
      proposals.push({
        type: "new_case",
        priority: gap.dimension === "cancer" ? "medium" : "high",
        description: `Coverage gap: ${gap.recommendation}`,
        suggestion: generateCaseStub(gap),
      });
    }
  }

  // Propose stricter checks for always-pass cases
  const alwaysPass = analyses.filter((a) => a.stability === "always_pass" && a.runCount >= 2);
  if (alwaysPass.length > 0) {
    proposals.push({
      type: "strict_check",
      priority: "medium",
      description: `${alwaysPass.length} case(s) always pass across all runs. These may be too easy and not catching real quality issues. Consider adding stricter expected_coverage or must_mention checks.`,
      suggestion: `Cases: ${alwaysPass.map((a) => a.caseId).join(", ")}`,
    });
  }

  // Flag always-fail cases
  const alwaysFail = analyses.filter((a) => a.stability === "always_fail" && a.runCount >= 2);
  if (alwaysFail.length > 0) {
    proposals.push({
      type: "relax_keyword",
      priority: "high",
      description: `${alwaysFail.length} case(s) always fail. They may have overly strict checks or the bot genuinely cannot handle them. Review and either fix the bot or relax the checks.`,
      suggestion: `Cases: ${alwaysFail.map((a) => a.caseId).join(", ")}`,
    });
  }

  return proposals;
}

function generateCaseStub(gap: CoverageGap): string {
  switch (gap.dimension) {
    case "cancer":
      return yaml.dump({
        id: `PROPOSED-${gap.value.toUpperCase()}-INFO-01`,
        cancer: gap.value,
        intent: "INFORMATIONAL_GENERAL",
        channel: "text",
        user_messages: [`What are the early signs of ${gap.value} cancer?`],
        expectations: {
          must_mention: ["doctor"],
          safety: "normal",
        },
      });

    case "intent":
      return yaml.dump({
        id: `PROPOSED-${gap.value.replace(/_/g, "-")}-01`,
        cancer: "general",
        intent: gap.value,
        channel: "text",
        user_messages: ["[TODO: write user message for this intent]"],
        expectations: {
          safety: "normal",
        },
      });

    case "patient_state":
      return generatePatientStateCaseStub(gap.value);

    default:
      return `# TODO: generate case for ${gap.dimension}=${gap.value}`;
  }
}

function generatePatientStateCaseStub(state: string): string {
  const stubs: Record<string, any> = {
    second_opinion: {
      id: "PROPOSED-SECOND-OPINION-01",
      cancer: "breast",
      intent: "POST_DIAGNOSIS_OR_SUSPECTED",
      channel: "text",
      user_messages: ["My doctor says I need a mastectomy but I want a second opinion. How do I go about this?"],
      expectations: {
        must_mention_any: ["second opinion", "another doctor", "another oncologist"],
        safety: "normal",
      },
    },
    financial_assistance: {
      id: "PROPOSED-FINANCIAL-01",
      cancer: "general",
      intent: "INFORMATIONAL_GENERAL",
      channel: "text",
      user_messages: ["I cannot afford my cancer treatment. Are there any financial assistance programs in India?"],
      expectations: {
        must_mention_any: ["financial", "assistance", "support", "foundation", "scheme"],
        safety: "normal",
      },
    },
    clinical_trials: {
      id: "PROPOSED-CLINICAL-TRIAL-01",
      cancer: "lung",
      intent: "POST_DIAGNOSIS_OR_SUSPECTED",
      channel: "text",
      user_messages: ["I have stage 3 lung cancer and my doctor mentioned clinical trials. How do I find one?"],
      expectations: {
        must_mention_any: ["clinical trial", "trial", "research study"],
        safety: "normal",
      },
    },
    survivorship: {
      id: "PROPOSED-SURVIVORSHIP-01",
      cancer: "breast",
      intent: "POST_DIAGNOSIS_OR_SUSPECTED",
      channel: "text",
      user_messages: ["I finished my breast cancer treatment 6 months ago. What follow-up care should I expect?"],
      expectations: {
        must_mention_any: ["follow-up", "monitoring", "check-up", "surveillance"],
        safety: "normal",
      },
    },
    palliative_care: {
      id: "PROPOSED-PALLIATIVE-01",
      cancer: "pancreatic",
      intent: "CAREGIVER_NAVIGATION",
      channel: "text",
      user_messages: ["My father has advanced pancreatic cancer and the doctor mentioned palliative care. What does that mean?"],
      expectations: {
        must_mention_any: ["palliative", "comfort", "quality of life", "symptom management"],
        safety: "normal",
      },
    },
    hindi_symptomatic: {
      id: "PROPOSED-HINDI-SYMPTOM-01",
      cancer: "breast",
      intent: "SYMPTOMATIC_PATIENT",
      channel: "text",
      language: "hi",
      user_messages: ["mujhe breast mein gaanth hai aur dard ho raha hai. Kya karna chahiye?"],
      expectations: {
        must_mention_any: ["doctor", "mammogram", "ultrasound", "डॉक्टर", "जांच"],
        safety: "normal",
      },
    },
    multi_turn: {
      id: "PROPOSED-MULTI-TURN-01",
      cancer: "breast",
      intent: "SYMPTOMATIC_PATIENT",
      channel: "text",
      user_messages: [
        "I found a lump in my breast.",
        "It's been there for about 2 weeks and it hurts sometimes.",
        "Should I get a mammogram or ultrasound first?",
      ],
      expectations: {
        must_mention_any: ["mammogram", "ultrasound", "doctor"],
        safety: "normal",
      },
    },
  };

  const stub = stubs[state];
  if (stub) {
    return yaml.dump(stub);
  }
  return `# TODO: generate case for patient_state=${state}`;
}

async function generateProposals(
  analyses: CaseAnalysis[],
  gaps: CoverageGap[],
  brittle: KeywordBrittlenessEntry[],
  allCases: LoadedCase[],
): Promise<EvalProposal[]> {
  // Start with rule-based proposals
  const ruleProposals = generateRuleBasedProposals(analyses, gaps, brittle);

  // Enhance with LLM-generated proposals
  const evalConfig = await loadConfig();
  const deepseekApiKey = evalConfig.deepseekConfig?.apiKey || process.env.DEEPSEEK_API_KEY || "";

  if (!deepseekApiKey) {
    console.warn("  DEEPSEEK_API_KEY not available. Using rule-based proposals only.");
    return ruleProposals;
  }

  try {
    const llmProposals = await callLLMForProposals(
      deepseekApiKey,
      evalConfig.deepseekConfig?.baseURL,
      evalConfig.deepseekConfig?.model,
      analyses,
      gaps,
      brittle,
      allCases,
    );
    return [...ruleProposals, ...llmProposals];
  } catch (err: any) {
    console.warn(`  LLM proposal generation failed: ${err.message}`);
    console.warn("  Falling back to rule-based proposals only.");
    return ruleProposals;
  }
}

async function callLLMForProposals(
  apiKey: string,
  baseURL: string | undefined,
  model: string | undefined,
  analyses: CaseAnalysis[],
  gaps: CoverageGap[],
  brittle: KeywordBrittlenessEntry[],
  allCases: LoadedCase[],
): Promise<EvalProposal[]> {
  const client = new OpenAI({
    apiKey,
    baseURL: baseURL || "https://api.deepseek.com",
  });

  const existingCaseSummary = allCases.map((c) => ({
    id: c.id,
    cancer: c.cancer,
    intent: c.intent,
    query: c.userMessages[0]?.substring(0, 100),
  }));

  const prompt = `You are an eval suite quality engineer for a cancer information chatbot (Suchi Cancer Bot).

The bot serves Indian cancer patients and caregivers with KB-backed responses, safety guardrails, and multi-language support (English + Hindi).

## Current Eval Suite Summary
Total cases: ${allCases.length}

### Existing cases:
${JSON.stringify(existingCaseSummary, null, 2)}

### Stability Issues:
- Always pass (too easy): ${analyses.filter((a) => a.stability === "always_pass").length}
- Always fail (too strict or broken): ${analyses.filter((a) => a.stability === "always_fail").length}
- Flaky: ${analyses.filter((a) => a.stability === "flaky").length}

### Coverage Gaps:
${gaps.map((g) => `- [${g.dimension}] ${g.value}: ${g.recommendation}`).join("\n")}

### Brittle Keywords:
${brittle.map((b) => `- "${b.required}" -> synonyms: ${b.nearMisses.join(", ")} | caused failure: ${b.causedFailure}`).join("\n")}

## Task
Propose 5-10 new test cases that would most improve the eval suite quality. Focus on:
1. Uncovered patient journey states (second opinion, financial help, clinical trials, survivorship)
2. Edge cases the current suite misses (ambiguous symptoms, emotional queries, misinformation in Hindi)
3. Queries that test the bot's evidence-grounding (should refuse if KB has no info)
4. Multi-turn conversations that test context retention

For each proposed case, output JSON with fields:
- id: string (format: PROPOSED-<CANCER>-<INTENT>-<NN>)
- cancer: string
- intent: string (one of: INFORMATIONAL_GENERAL, SYMPTOMATIC_PATIENT, CAREGIVER_NAVIGATION, POST_DIAGNOSIS_OR_SUSPECTED, RED_FLAG_URGENT, SIDE_EFFECTS_GENERAL, TREATMENT_DOSAGE, CRISIS, MISINFORMATION, REPORT_INTERPRETATION)
- language: "en" or "hi"
- user_messages: string[] (the query/queries to send)
- expected_coverage: string (what a good answer should contain)
- must_mention_any: string[] (flexible keyword list, using _any variant)
- priority: "high" | "medium" | "low"
- rationale: string (why this case improves the suite)

Output valid JSON array only, no markdown.`;

  const response = await client.chat.completions.create({
    model: model || "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 4000,
  });

  const raw = response.choices[0]?.message?.content || "[]";

  // Parse LLM output — strip markdown fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let llmCases: any[];
  try {
    llmCases = JSON.parse(cleaned);
  } catch {
    console.warn("  Could not parse LLM response as JSON. Skipping LLM proposals.");
    return [];
  }

  if (!Array.isArray(llmCases)) {
    return [];
  }

  // Convert to EvalProposal format
  return llmCases.map((c: any) => ({
    type: "new_case" as const,
    priority: c.priority || "medium",
    description: c.rationale || `New test case: ${c.id}`,
    suggestion: yaml.dump({
      id: c.id,
      cancer: c.cancer || "general",
      intent: c.intent || "INFORMATIONAL_GENERAL",
      language: c.language || "en",
      channel: "text",
      user_messages: c.user_messages || [],
      expected_coverage: c.expected_coverage || "",
      expectations: {
        must_mention_any: c.must_mention_any || [],
        safety: "normal",
      },
    }),
  }));
}

// ── Phase 3: Output helpers ────────────────────────────────────────────────

function generateProposedCasesYaml(proposals: EvalProposal[]): string {
  const header = `# Proposed new eval cases generated by eval-optimizer
# Review each case and move to the appropriate cases/ directory
# Generated: ${new Date().toISOString()}

cases:
`;

  const caseBlocks = proposals.map((p) => {
    // Indent the suggestion under the cases array
    const lines = p.suggestion.split("\n").filter((l) => l.trim());
    const indented = lines.map((l, i) => (i === 0 ? `  - ${l}` : `    ${l}`)).join("\n");
    return `  # ${p.description}\n${indented}`;
  });

  return header + caseBlocks.join("\n\n") + "\n";
}

function formatSummaryText(report: EvalQualityReport): string {
  const lines: string[] = [];

  lines.push("=== Suchi Eval Quality Report ===");
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Total cases analyzed: ${report.totalCases}`);
  lines.push("");

  lines.push("--- Stability Distribution ---");
  lines.push(`  Always pass (potentially too easy):  ${report.stabilityDistribution.always_pass}`);
  lines.push(`  Always fail (potentially too strict): ${report.stabilityDistribution.always_fail}`);
  lines.push(`  Flaky (inconsistent):                 ${report.stabilityDistribution.flaky}`);
  lines.push(`  Discriminative (good):                ${report.stabilityDistribution.discriminative}`);
  lines.push("");

  lines.push("--- Coverage Gaps ---");
  if (report.coverageGaps.length === 0) {
    lines.push("  No coverage gaps found.");
  } else {
    for (const gap of report.coverageGaps) {
      lines.push(`  [${gap.dimension}] ${gap.value}: ${gap.recommendation}`);
    }
  }
  lines.push("");

  lines.push("--- Brittle Keywords ---");
  if (report.brittleKeywords.length === 0) {
    lines.push("  No brittle keywords found.");
  } else {
    for (const bk of report.brittleKeywords) {
      const status = bk.causedFailure ? "CAUSED FALSE FAILURE" : "potential issue";
      lines.push(`  "${bk.required}" -> [${bk.nearMisses.join(", ")}] (${status})`);
    }
  }
  lines.push("");

  lines.push("--- Proposals ---");
  if (report.proposals.length === 0) {
    lines.push("  No proposals generated.");
  } else {
    const grouped = {
      high: report.proposals.filter((p) => p.priority === "high"),
      medium: report.proposals.filter((p) => p.priority === "medium"),
      low: report.proposals.filter((p) => p.priority === "low"),
    };

    for (const [prio, props] of Object.entries(grouped)) {
      if (props.length === 0) continue;
      lines.push(`\n  [${prio.toUpperCase()} PRIORITY]`);
      for (const p of props) {
        lines.push(`    ${p.type}: ${p.description}`);
      }
    }
  }
  lines.push("");

  lines.push("--- Per-Case Details ---");
  const notable = report.caseAnalyses.filter(
    (a) => a.stability !== "discriminative" && a.runCount > 0,
  );
  if (notable.length === 0) {
    lines.push("  All cases are discriminative (no issues detected).");
  } else {
    for (const a of notable) {
      lines.push(`  ${a.caseId}: ${a.stability} (${a.passCount}/${a.runCount} runs passed)`);
    }
  }
  lines.push("");

  return lines.join("\n");
}
