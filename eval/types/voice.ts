/** Voice E2E test case definition */
export interface VoiceTestCase {
  id: string;
  variant: string;
  description: string;
  /** Expected transcript the TTS would produce */
  expectedTranscript: string;
  /** Language for TTS synthesis and STT */
  locale: string;
  /** Path to pre-recorded WAV file (if available) */
  fixtureFile?: string;
  /** Variant-specific modifications for synthetic audio */
  synthetic?: {
    speakingRate?: number;
    addNoise?: boolean;
    noiseLevel?: number;
  };
  expectations: VoiceExpectations;
}

/** What we expect from the voice pipeline output */
export interface VoiceExpectations {
  /** Minimum STT confidence threshold */
  minConfidence: number;
  /** Expected cancer type to be extracted (if any) */
  expectedCancerType?: string;
  /** Expected city to be extracted (if any) */
  expectedCity?: string;
  /** Expected safety classification */
  expectedSafety: string;
  /** Keywords that should appear in transcript — English (bag of words check) */
  transcriptKeywords: string[];
  /** Keywords in Hindi/Devanagari — scored separately, best of en/hi used */
  transcriptKeywordsHi?: string[];
  /** Max acceptable latency in ms */
  maxLatencyMs: number;
}

/** Result of evaluating a single voice test case */
export interface VoiceEvaluationResult {
  testCaseId: string;
  variant: string;
  transport: 'http' | 'ws';
  passed: boolean;
  scores: {
    sttAccuracy: number;
    entityExtraction: number;
    responseSafety: number;
    ttsQuality: number;
    latency: number;
  };
  details: {
    transcript: string;
    confidence: number;
    responseText: string;
    audioUrl: string | null;
    safety: string;
    latencyMs: number;
    detectedCancerType?: string;
    detectedCity?: string;
  };
  errors?: string[];
  executionTimeMs: number;
}

/** Result from a single transport (HTTP or WS) */
export interface VoiceTransportResult {
  transport: 'http' | 'ws';
  sessionId: string;
  transcript: string;
  confidence: number;
  responseText: string;
  voiceResponseText: string;
  audioUrl: string | null;
  safety: { classification: string; actions: any[] };
  latency: {
    sttMs?: number;
    chatMs?: number;
    ttsMs?: number;
    totalMs?: number;
  };
  messageId?: string;
}

/** Configuration for voice E2E evaluation */
export interface VoiceEvalConfig {
  apiBaseUrl: string;
  transport: 'http' | 'ws' | 'both';
  synthetic: boolean;
  casesPath: string;
  outputPath: string;
  rubricsPath: string;
  authBearer?: string;
  timeoutMs: number;
}

/** Voice E2E report */
export interface VoiceEvalReport {
  runId: string;
  timestamp: string;
  config: {
    transport: string;
    synthetic: boolean;
    apiBaseUrl: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    averageScores: {
      sttAccuracy: number;
      entityExtraction: number;
      responseSafety: number;
      ttsQuality: number;
      latency: number;
    };
    executionTimeMs: number;
  };
  results: VoiceEvaluationResult[];
  failures: VoiceEvaluationResult[];
}
