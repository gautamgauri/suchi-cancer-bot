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
   * Evaluate a single test case
   */
  async evaluateTestCase(testCase: TestCase): Promise<EvaluationResult> {
    const startTime = Date.now();
    let sessionId: string | null = null;

    try {
      // Create session
      sessionId = await this.apiClient.createSession("web");

      // Execute conversation
      const { finalResponse, allResponses } = await this.apiClient.executeConversation(
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
        executionTimeMs: Date.now() - startTime,
      };

      // Calculate score and determine pass
      result.score = this.reportGenerator.calculateScore(result, rubric);
      result.passed = this.reportGenerator.determinePass(result, rubric);

      return result;
    } catch (error: any) {
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
      // Sequential execution
      for (const testCase of testCases) {
        const result = await this.evaluateTestCase(testCase);
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
    return testCases.filter((testCase) => {
      if (filters.tier !== undefined && testCase.tier !== filters.tier) {
        return false;
      }
      if (filters.cancer && testCase.cancer !== filters.cancer) {
        return false;
      }
      if (filters.intent && testCase.intent !== filters.intent) {
        return false;
      }
      if (filters.caseId && testCase.id !== filters.caseId) {
        return false;
      }
      return true;
    });
  }
}

