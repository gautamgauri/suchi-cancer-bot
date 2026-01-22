import { ApiClient } from "./api-client";
import { DeterministicChecker } from "./deterministic-checker";
import { LLMJudge } from "./llm-judge";
import { ReportGenerator } from "./report-generator";
import {
  TestCase,
  Rubric,
  RubricPack,
  EvaluationResult,
  EvaluationConfig,
  GlobalConfig,
} from "../types";
import * as yaml from "js-yaml";
import * as fs from "fs/promises";
import {
  canonicalCancerType,
  canonicalIntent,
  canonicalCaseId,
  getAvailableCancerTypes,
  getAvailableIntents,
} from "../utils/canonicalize";

// Trusted sources list (matches apps/api/src/config/trusted-sources.config.ts)
const TRUSTED_SOURCES = [
  '01_suchi_oncotalks',
  '02_nci_core',
  '03_who_public_health',
  '04_iarc_stats',
  '05_india_ncg',
  '06_pmc_selective',
  '99_local_navigation'
];

function isTrustedSource(sourceType: string | null | undefined): boolean {
  if (!sourceType) return false;
  return TRUSTED_SOURCES.includes(sourceType);
}

export class Evaluator {
  private apiClient: ApiClient;
  private deterministicChecker: DeterministicChecker;
  private llmJudge: LLMJudge;
  private reportGenerator: ReportGenerator;
  private config: EvaluationConfig;
  private rubricPack: RubricPack;
  private globalConfig: GlobalConfig;

  constructor(config: EvaluationConfig, rubricPack: RubricPack) {
    this.config = config;
    this.rubricPack = rubricPack;
    this.globalConfig = rubricPack.global;

    this.apiClient = new ApiClient(config.apiBaseUrl, config.timeoutMs, config.authBearer);
    this.deterministicChecker = new DeterministicChecker(this.globalConfig);
    this.llmJudge = new LLMJudge(config);
    this.reportGenerator = new ReportGenerator();
  }

  /**
   * Load test cases from YAML file
   */
  static async loadTestCases(filePath: string): Promise<TestCase[]> {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = yaml.load(content) as any;
    
    if (!parsed.cases || !Array.isArray(parsed.cases)) {
      throw new Error("Invalid test case file: missing 'cases' array");
    }

    return parsed.cases as TestCase[];
  }

  /**
   * Load rubrics from JSON file
   */
  static async loadRubrics(filePath: string): Promise<RubricPack> {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as RubricPack;
  }

  /**
   * Get rubric for a specific intent
   */
  private getRubric(intent: string): Rubric | null {
    return this.rubricPack.rubrics[intent] || null;
  }

  /**
   * Evaluate a single test case with timeout
   */
  async evaluateTestCase(testCase: TestCase): Promise<EvaluationResult> {
    const startTime = Date.now();
    let sessionId: string | null = null;

    // ✅ NEW: Wrap in timeout promise (2 minutes per case)
    const PER_CASE_TIMEOUT = 120000; // 2 minutes

    try {
      const result = await Promise.race([
        this.executeTestCase(testCase, sessionId, startTime),
        this.timeoutPromise(PER_CASE_TIMEOUT, testCase.id),
      ]);
      
      return result;
    } catch (error: any) {
      console.error(`  ❌ Case ${testCase.id} failed: ${error.message}`);
      
      return {
        testCaseId: testCase.id,
        passed: false,
        score: 0,
        deterministicResults: [],
        responseText: "",
        responseMetadata: {
          sessionId: sessionId || "",
          messageId: "",
        },
        error: error.message,
        executionTimeMs: Date.now() - startTime,
        timedOut: error.message.includes('timeout'), // ✅ NEW: Flag timeouts
      };
    }
  }

  /**
   * ✅ NEW: Helper method for timeout
   */
  private timeoutPromise(ms: number, caseId: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Case ${caseId} timeout after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * ✅ NEW: Extract main execution logic
   */
  private async executeTestCase(
    testCase: TestCase,
    sessionId: string | null,
    startTime: number
  ): Promise<EvaluationResult> {
    try {
      // Create session (measure time)
      const sessionStart = Date.now();
      sessionId = await this.apiClient.createSession("web");
      const sessionCreateMs = Date.now() - sessionStart;

      // Execute conversation (measure send time)
      const { finalResponse, allResponses, timingMs } = await this.apiClient.executeConversation(
        sessionId,
        testCase.user_messages,
        "web"
      );

      const fullResponseText = this.apiClient.extractFullResponseText(allResponses);
      const questionCount = this.apiClient.countClarifyingQuestions(allResponses);

      // Get rubric for this intent
      const rubric = this.getRubric(testCase.intent);
      if (!rubric) {
        throw new Error(`No rubric found for intent: ${testCase.intent}`);
      }

      // Run deterministic checks
      const deterministicResults = this.deterministicChecker.runChecks(
        rubric.deterministic_checks,
        fullResponseText,
        questionCount,
        finalResponse.citations,
        finalResponse.citationConfidence
      );

      // PHASE 2.5+: Citation contract guardrail
      // If retrievedChunks > 0 AND intent is medical, citations must be >= 2
      const medicalIntents = [
        'INFORMATIONAL_GENERAL',
        'INFORMATIONAL_SYMPTOMS',
        'SYMPTOMATIC_PATIENT',
        'CAREGIVER_NAVIGATION',
        'POST_DIAGNOSIS_OR_SUSPECTED',
        'RED_FLAG_URGENT',
        'TREATMENT_OPTIONS_GENERAL',
        'SIDE_EFFECTS_GENERAL'
      ];
      const isMedicalIntent = medicalIntents.includes(testCase.intent);
      const retrievedChunksCount = finalResponse.retrievedChunks?.length || 0;
      const citationCount = finalResponse.citations?.length || 0;

      if (isMedicalIntent && retrievedChunksCount > 0 && citationCount < 2) {
        deterministicResults.push({
          checkId: 'citation_contract',
          passed: false,
          required: true,
          error: `Citation contract breach: retrieved ${retrievedChunksCount} chunks but only ${citationCount} citations (need >= 2 for medical intent ${testCase.intent})`,
          details: {
            retrievedChunksCount,
            citationCount,
            intent: testCase.intent,
            reason: 'Medical content with retrieval must have >= 2 citations'
          }
        });
      } else if (isMedicalIntent && retrievedChunksCount > 0) {
        // Contract satisfied - log for visibility
        deterministicResults.push({
          checkId: 'citation_contract',
          passed: true,
          required: true,
          details: {
            retrievedChunksCount,
            citationCount,
            intent: testCase.intent
          }
        });
      }

      // Check if we should skip LLM judge (if required deterministic checks failed)
      const requiredDeterministicFailed = deterministicResults.some(
        (r) => r.required && !r.passed
      );

      let llmJudgeResults;
      if (!requiredDeterministicFailed && rubric.llm_judge) {
        // Extract retrieved chunk info from citations
        // Note: Full chunk content is not available in API response
        // For full validation, API would need to return chunk content in response metadata
        const retrievedChunks: Array<{ docId: string; chunkId: string; content: string }> = [];
        if (finalResponse.citations) {
          // We have docId and chunkId from citations, but not content
          // For now, pass empty content - the judge will still check for unsupported claims
          // based on citation presence, though full validation requires chunk content
          retrievedChunks.push(...finalResponse.citations.map(c => ({
            docId: c.docId,
            chunkId: c.chunkId,
            content: "" // Content not available in API response
          })));
        }
        
        // Run LLM judge
        llmJudgeResults = await this.llmJudge.judge(
          fullResponseText,
          rubric.llm_judge,
          rubric.llm_judge.checks,
          {
            cancer: testCase.cancer,
            intent: testCase.intent,
            mustMentionTests: testCase.expectations.must_mention_tests,
            retrievedChunks: retrievedChunks.length > 0 ? retrievedChunks : undefined
          }
        );
      }

      // Calculate retrieval quality metrics
      const citations = finalResponse.citations || [];
      const retrievedChunks = finalResponse.retrievedChunks || [];
      
      // Check top-3 trusted source presence
      const top3Chunks = retrievedChunks.slice(0, 3);
      const top3TrustedPresence = top3Chunks.some(chunk => 
        chunk.isTrustedSource === true || 
        (chunk.sourceType && isTrustedSource(chunk.sourceType))
      );
      const top3SourceTypes = top3Chunks
        .map(chunk => chunk.sourceType)
        .filter((st): st is string => st !== null && st !== undefined);

      // Calculate citation coverage (has citations)
      const citationCoverage = citations.length > 0 ? 1.0 : 0.0;

      // Check for abstention
      const hasAbstention = !!finalResponse.abstentionReason;

      // Calculate score and determine pass/fail
      const result: EvaluationResult = {
        testCaseId: testCase.id,
        passed: false, // Will be set below
        score: 0,
        deterministicResults,
        llmJudgeResults,
        responseText: fullResponseText,
        responseMetadata: {
          sessionId,
          messageId: finalResponse.messageId,
          citations: finalResponse.citations,
          citationConfidence: finalResponse.citationConfidence,
          retrievedChunks: finalResponse.retrievedChunks,
          abstentionReason: finalResponse.abstentionReason,
        },
        retrievalQuality: {
          top3TrustedPresence,
          top3SourceTypes,
          citationCoverage,
          hasAbstention,
        },
        timingMs: {
          sessionCreateMs,
          chatSendMs: timingMs.totalMs,
          perMessageMs: timingMs.perMessageMs,
        },
        executionTimeMs: Date.now() - startTime,
      };

      // Calculate score and determine pass
      result.score = this.reportGenerator.calculateScore(result, rubric);
      result.passed = this.reportGenerator.determinePass(result, rubric);

      return result;
    } catch (error: any) {
      const errorText = error?.message || "Unknown error";
      const errorStep = errorText.includes("Failed to create session")
        ? "session_create"
        : errorText.includes("Failed to send message") || errorText.includes("timeout")
        ? "chat_send"
        : "unknown";
      return {
        testCaseId: testCase.id,
        passed: false,
        score: 0,
        deterministicResults: [],
        responseText: "",
        responseMetadata: {
          sessionId: sessionId || "",
          messageId: "",
        },
        error: errorText,
        errorStep,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Evaluate multiple test cases
   */
  async evaluateTestCases(testCases: TestCase[]): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];

    if (this.config.parallel && this.config.maxConcurrency) {
      // Parallel execution with concurrency limit
      const concurrency = this.config.maxConcurrency;
      for (let i = 0; i < testCases.length; i += concurrency) {
        const batch = testCases.slice(i, i + concurrency);
        const batchResults = await Promise.all(
          batch.map((testCase) => this.evaluateTestCase(testCase))
        );
        results.push(...batchResults);
      }
    } else {
      // ✅ UPDATED: Sequential execution with progress logging
      for (const testCase of testCases) {
        const caseNum = testCases.indexOf(testCase) + 1;
        const caseStartTime = Date.now();
        
        console.log(`\n[${caseNum}/${testCases.length}] ${testCase.id}`);
        console.log(`  Query: "${testCase.user_messages[0]}"`);
        
        const result = await this.evaluateTestCase(testCase);
        
        const duration = Date.now() - caseStartTime;
        const status = result.passed ? '✅' : result.error ? '❌' : '⚠️';
        console.log(`  ${status} Completed in ${(duration / 1000).toFixed(1)}s`);
        
        if (result.error) {
          console.log(`  Error: ${result.error}`);
        } else {
          console.log(`  Score: ${(result.score * 100).toFixed(1)}%`);
          const citationCount = result.responseMetadata.citations?.length || 0;
          console.log(`  Citations: ${citationCount}`);
        }
        
        results.push(result);
        
        // Small delay between tests to avoid rate limiting
        if (testCases.indexOf(testCase) < testCases.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    return results;
  }

  /**
   * Filter test cases by criteria
   * 
   * ✅ CANONICALIZED: All string comparisons use canonicalized values
   * This prevents case-sensitivity and whitespace issues
   */
  static filterTestCases(
    testCases: TestCase[],
    filters: {
      tier?: number;
      cancer?: string;
      intent?: string;
      caseId?: string;
    }
  ): TestCase[] {
    // Canonicalize filter values
    const canonicalCancer = filters.cancer ? canonicalCancerType(filters.cancer) : null;
    const canonicalIntentFilter = filters.intent ? canonicalIntent(filters.intent) : null;
    const canonicalCaseIdFilter = filters.caseId ? canonicalCaseId(filters.caseId) : null;

    return testCases.filter((testCase) => {
      // Tier: exact match (number)
      if (filters.tier !== undefined && testCase.tier !== filters.tier) {
        return false;
      }
      
      // Cancer: canonicalized comparison
      if (canonicalCancer) {
        const testCaseCancer = canonicalCancerType(testCase.cancer);
        if (testCaseCancer !== canonicalCancer) {
          return false;
        }
      }
      
      // Intent: canonicalized comparison
      if (canonicalIntentFilter) {
        const testCaseIntent = canonicalIntent(testCase.intent);
        if (testCaseIntent !== canonicalIntentFilter) {
          return false;
        }
      }
      
      // Case ID: canonicalized comparison (preserves case but normalizes whitespace)
      if (canonicalCaseIdFilter) {
        const testCaseId = canonicalCaseId(testCase.id);
        if (testCaseId !== canonicalCaseIdFilter) {
          return false;
        }
      }
      
      return true;
    });
  }

  /**
   * ✅ NEW: Preflight validation - fail fast if filters match zero cases
   * 
   * Returns validation info including:
   * - Available values in suite
   * - Selected count
   * - Warnings if selection seems wrong
   */
  static validateFilters(
    testCases: TestCase[],
    filters: {
      tier?: number;
      cancer?: string;
      intent?: string;
      caseId?: string;
    }
  ): {
    totalCases: number;
    selectedCases: number;
    availableCancerTypes: string[];
    availableIntents: string[];
    warnings: string[];
    errors: string[];
  } {
    const selected = this.filterTestCases(testCases, filters);
    const availableCancerTypes = getAvailableCancerTypes(testCases);
    const availableIntents = getAvailableIntents(testCases);
    
    const warnings: string[] = [];
    const errors: string[] = [];

    // ✅ FAIL-FAST: If filter matches 0 cases, that's an error
    if (selected.length === 0) {
      const filterDesc: string[] = [];
      if (filters.cancer) filterDesc.push(`cancer="${filters.cancer}"`);
      if (filters.intent) filterDesc.push(`intent="${filters.intent}"`);
      if (filters.tier !== undefined) filterDesc.push(`tier=${filters.tier}`);
      if (filters.caseId) filterDesc.push(`caseId="${filters.caseId}"`);
      
      errors.push(
        `Filter matched 0 cases. Filters: ${filterDesc.join(', ')}`
      );
      
      if (filters.cancer) {
        const canonical = canonicalCancerType(filters.cancer);
        const suggestions = availableCancerTypes.filter(ct => 
          ct.includes(canonical) || canonical.includes(ct)
        );
        if (suggestions.length > 0) {
          errors.push(`Did you mean one of: ${suggestions.join(', ')}?`);
        } else {
          errors.push(`Available cancer types: ${availableCancerTypes.join(', ')}`);
        }
      }
    }

    // Warn if selection is unexpectedly small
    if (selected.length > 0 && selected.length < testCases.length * 0.1) {
      warnings.push(
        `Filter selected only ${selected.length} cases (${((selected.length / testCases.length) * 100).toFixed(1)}% of suite). Is this expected?`
      );
    }

    return {
      totalCases: testCases.length,
      selectedCases: selected.length,
      availableCancerTypes,
      availableIntents,
      warnings,
      errors,
    };
  }
}

