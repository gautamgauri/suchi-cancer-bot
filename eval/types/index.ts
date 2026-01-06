/**
 * Type definitions for evaluation framework
 */

export interface TestCase {
  id: string;
  tier: number;
  cancer: string;
  intent: string;
  user_messages: string[];
  expectations: TestExpectations;
}

export interface TestExpectations {
  max_clarifying_questions?: number;
  required_sections?: string[];
  warning_signs_min?: number;
  tests_min?: number;
  doctor_questions_min?: number;
  preparation_checklist_min?: number;
  urgency_timeline_required?: boolean;
  disclaimer_required?: boolean;
  emergency_required?: boolean;
  must_include_any_phrases?: string[];
  timeline_target?: string;
  must_not?: string[];
  must_mention_tests?: string[];
}

export interface Rubric {
  rubric_id: string;
  intent: string;
  pass_threshold: number;
  weights: Record<string, number>;
  deterministic_checks: DeterministicCheck[];
  llm_judge: LLMJudgeConfig;
}

export interface DeterministicCheck {
  id: string;
  description?: string;
  required: boolean;
  type: string;
  params: Record<string, any>;
}

export interface LLMJudgeConfig {
  model: string;
  prompt_contract: {
    format: string;
    require_evidence_quotes: boolean;
    max_quote_words_per_field: number;
  };
  checks: LLMCheck[];
  output_schema: any;
}

export interface LLMCheck {
  id: string;
  description: string;
  required: boolean;
  type: string;
  params?: Record<string, any>;
}

export interface RubricPack {
  rubric_pack_id: string;
  version: string;
  global: GlobalConfig;
  rubrics: Record<string, Rubric>;
}

export interface GlobalConfig {
  language: string;
  disclaimer: {
    required: boolean;
    patterns_any: string[];
  };
  prohibited_diagnosis_language: {
    patterns_any: string[];
  };
  section_headers_suggested: string[];
  counting_rules: {
    question_count_method: string;
    interrogatives_patterns_any: string[];
    bullet_patterns_any: string[];
  };
}

export interface ChatResponse {
  sessionId: string;
  messageId: string;
  responseText: string;
  safety: {
    classification: "normal" | "refusal" | "red_flag" | "self_harm";
    actions: string[];
  };
  citations?: Array<{
    docId: string;
    chunkId: string;
    position: number;
  }>;
  citationConfidence?: string;
  abstentionReason?: string;
}

export interface DeterministicCheckResult {
  checkId: string;
  passed: boolean;
  required: boolean;
  error?: string;
  details?: Record<string, any>;
}

export interface LLMJudgeResult {
  checkId: string;
  passed: boolean;
  score?: number;
  evidence?: string;
  count?: number;
  error?: string;
}

export interface LLMJudgeResponse {
  pass: boolean;
  score: number;
  checks: Record<string, {
    ok: boolean;
    count?: number;
    evidence: string;
  }>;
  fail_reasons: string[];
}

export interface EvaluationResult {
  testCaseId: string;
  passed: boolean;
  score: number;
  deterministicResults: DeterministicCheckResult[];
  llmJudgeResults?: LLMJudgeResult[];
  responseText: string;
  responseMetadata: {
    sessionId: string;
    messageId: string;
    citations?: ChatResponse["citations"];
    citationConfidence?: string;
  };
  error?: string;
  executionTimeMs: number;
}

export interface EvaluationReport {
  runId: string;
  timestamp: string;
  config: EvaluationConfig;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    averageScore: number;
    executionTimeMs: number;
  };
  results: EvaluationResult[];
  failures: EvaluationResult[];
}

export interface EvaluationConfig {
  apiBaseUrl: string;
  llmProvider: "vertex_ai" | "openai" | "deepseek";
  vertexAiConfig?: {
    project: string;
    location: string;
    model: string;
  };
  openAiConfig?: {
    model: string;
    apiKey: string;
  };
  deepseekConfig?: {
    model: string;
    apiKey: string;
    baseURL?: string;
  };
  timeoutMs: number;
  retries: number;
  parallel: boolean;
  maxConcurrency?: number;
}

