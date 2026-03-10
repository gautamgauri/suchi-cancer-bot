import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { VoiceApiClient } from './voice-api-client';
import { AudioSynthesizer } from './audio-synthesizer';
import {
  VoiceTestCase,
  VoiceEvaluationResult,
  VoiceEvalConfig,
  VoiceTransportResult,
} from '../types/voice';

/**
 * Voice E2E evaluator — runs test cases against HTTP and/or WS transport,
 * scores 5 dimensions, produces pass/fail per case.
 */
export class VoiceEvaluator {
  private readonly client: VoiceApiClient;
  private readonly synthesizer: AudioSynthesizer;
  private readonly config: VoiceEvalConfig;
  private rubrics: any;

  constructor(config: VoiceEvalConfig) {
    this.config = config;
    this.client = new VoiceApiClient(
      config.apiBaseUrl,
      config.timeoutMs,
      config.authBearer,
    );
    this.synthesizer = new AudioSynthesizer(
      path.join(path.dirname(config.casesPath), 'fixtures'),
    );
  }

  /**
   * Load voice test cases from YAML file.
   */
  static async loadTestCases(filePath: string): Promise<VoiceTestCase[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = yaml.load(content) as { cases: VoiceTestCase[] };
    return parsed.cases || [];
  }

  /**
   * Load rubrics from JSON file.
   */
  async loadRubrics(filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    this.rubrics = JSON.parse(content);
  }

  /**
   * Evaluate all test cases.
   */
  async evaluateAll(
    testCases: VoiceTestCase[],
  ): Promise<VoiceEvaluationResult[]> {
    const results: VoiceEvaluationResult[] = [];

    // Synthesize audio if in synthetic mode
    let audioFiles: Map<string, string>;
    if (this.config.synthetic) {
      console.log('\nSynthesizing test audio...');
      audioFiles = await this.synthesizer.synthesizeAll(testCases);
    } else {
      // Use fixture files
      audioFiles = new Map<string, string>();
      for (const tc of testCases) {
        if (tc.fixtureFile) {
          audioFiles.set(tc.id, tc.fixtureFile);
        }
      }
    }

    const transports: Array<'http' | 'ws'> =
      this.config.transport === 'both'
        ? ['http', 'ws']
        : [this.config.transport];

    for (const tc of testCases) {
      const audioPath = audioFiles.get(tc.id);
      if (!audioPath) {
        console.log(`  Skipping ${tc.id}: no audio file`);
        continue;
      }

      for (const transport of transports) {
        console.log(
          `\n  [${transport.toUpperCase()}] Evaluating ${tc.id} (${tc.variant})...`,
        );
        const result = await this.evaluateCase(
          tc,
          audioPath,
          transport,
        );
        results.push(result);

        const status = result.passed ? 'PASS' : 'FAIL';
        console.log(
          `  ${status} | STT=${result.scores.sttAccuracy.toFixed(2)} Entity=${result.scores.entityExtraction} Safety=${result.scores.responseSafety} TTS=${result.scores.ttsQuality} Latency=${result.scores.latency}`,
        );
      }
    }

    return results;
  }

  /**
   * Evaluate a single test case on a single transport.
   */
  async evaluateCase(
    testCase: VoiceTestCase,
    audioPath: string,
    transport: 'http' | 'ws',
  ): Promise<VoiceEvaluationResult> {
    const started = Date.now();
    const errors: string[] = [];

    let transportResult: VoiceTransportResult;
    try {
      const sessionId = await this.client.createSession('voice');

      if (transport === 'http') {
        transportResult = await this.client.sendVoiceHttp(
          sessionId,
          audioPath,
          testCase.locale,
        );
      } else {
        transportResult = await this.client.sendVoiceWs(
          sessionId,
          audioPath,
          testCase.locale,
        );
      }
    } catch (err: any) {
      return {
        testCaseId: testCase.id,
        variant: testCase.variant,
        transport,
        passed: false,
        scores: {
          sttAccuracy: 0,
          entityExtraction: 0,
          responseSafety: 0,
          ttsQuality: 0,
          latency: 0,
        },
        details: {
          transcript: '',
          confidence: 0,
          responseText: '',
          audioUrl: null,
          safety: 'error',
          latencyMs: Date.now() - started,
        },
        errors: [err.message],
        executionTimeMs: Date.now() - started,
      };
    }

    // Score 5 dimensions — take best of English/Hindi keyword scores
    const sttEn = this.scoreSttAccuracy(
      transportResult.transcript,
      testCase.expectations.transcriptKeywords,
    );
    const sttHi = this.scoreSttAccuracy(
      transportResult.transcript,
      testCase.expectations.transcriptKeywordsHi || [],
    );
    const sttAccuracy = Math.max(sttEn, sttHi);

    const entityExtraction = this.scoreEntityExtraction(
      transportResult.responseText,
      transportResult.transcript,
      testCase.expectations,
    );

    const responseSafety = this.scoreResponseSafety(
      transportResult.safety?.classification,
      testCase.expectations.expectedSafety,
    );

    let ttsQuality = 0;
    if (transportResult.audioUrl) {
      const reachable = await this.client.isAudioUrlReachable(
        transportResult.audioUrl,
      );
      ttsQuality = reachable ? 1 : 0;
      if (!reachable) {
        errors.push('Audio URL not reachable');
      }
    }

    const totalLatencyMs =
      transportResult.latency?.totalMs ??
      (transportResult.latency?.chatMs ?? 0) +
        (transportResult.latency?.ttsMs ?? 0) +
        (transportResult.latency?.sttMs ?? 0);
    const latencyScore =
      totalLatencyMs <= testCase.expectations.maxLatencyMs ? 1 : 0;

    // Case passes if all 5 dimensions > 0
    const passed =
      sttAccuracy > 0 &&
      entityExtraction > 0 &&
      responseSafety > 0 &&
      ttsQuality > 0 &&
      latencyScore > 0;

    return {
      testCaseId: testCase.id,
      variant: testCase.variant,
      transport,
      passed,
      scores: {
        sttAccuracy,
        entityExtraction,
        responseSafety,
        ttsQuality,
        latency: latencyScore,
      },
      details: {
        transcript: transportResult.transcript,
        confidence: transportResult.confidence,
        responseText: transportResult.responseText,
        audioUrl: transportResult.audioUrl,
        safety: transportResult.safety?.classification || 'unknown',
        latencyMs: totalLatencyMs,
      },
      errors: errors.length > 0 ? errors : undefined,
      executionTimeMs: Date.now() - started,
    };
  }

  /**
   * Bag-of-words Jaccard similarity between transcript and expected keywords.
   */
  private scoreSttAccuracy(
    transcript: string,
    expectedKeywords: string[],
  ): number {
    if (!expectedKeywords || expectedKeywords.length === 0) return 1;
    if (!transcript) return 0;

    const transcriptWords = new Set(
      transcript
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .split(/\s+/)
        .filter((w) => w.length > 1),
    );

    const expectedLower = expectedKeywords.map((k) => k.toLowerCase());
    let matches = 0;
    for (const keyword of expectedLower) {
      // Check if keyword (which may be multi-word) appears in transcript
      if (transcript.toLowerCase().includes(keyword)) {
        matches++;
      } else {
        // Check individual word match
        const keywordWords = keyword.split(/\s+/);
        const anyMatch = keywordWords.some((w) => transcriptWords.has(w));
        if (anyMatch) matches += 0.5;
      }
    }

    return matches / expectedLower.length;
  }

  /** Hindi aliases for cancer types (English key → all known forms) */
  private static readonly CANCER_TYPE_ALIASES: Record<string, string[]> = {
    breast: ['breast', 'ब्रेस्ट', 'स्तन'],
    lung: ['lung', 'लंग', 'फेफड़'],
    cervical: ['cervical', 'सर्वाइकल', 'गर्भाशय'],
    stomach: ['stomach', 'स्टमक', 'पेट'],
    oral: ['oral', 'ओरल', 'मुंह'],
    blood: ['blood', 'ब्लड', 'खून'],
    liver: ['liver', 'लिवर', 'यकृत'],
  };

  /** Hindi aliases for city names */
  private static readonly CITY_ALIASES: Record<string, string[]> = {
    muzaffarpur: ['muzaffarpur', 'मुजफ्फरपुर'],
    patna: ['patna', 'पटना'],
    varanasi: ['varanasi', 'वाराणसी'],
    delhi: ['delhi', 'दिल्ली'],
    mumbai: ['mumbai', 'मुंबई'],
    kolkata: ['kolkata', 'कोलकाता'],
    lucknow: ['lucknow', 'लखनऊ'],
  };

  /**
   * Score entity extraction: cancer type and city detection.
   * Uses bilingual aliases so Hindi transcripts match English expectations.
   */
  private scoreEntityExtraction(
    responseText: string,
    transcript: string,
    expectations: VoiceTestCase['expectations'],
  ): number {
    let checks = 0;
    let passed = 0;
    const combined = `${transcript} ${responseText}`.toLowerCase();

    // Check cancer type if expected
    if (expectations.expectedCancerType) {
      checks++;
      const key = expectations.expectedCancerType.toLowerCase();
      const aliases = VoiceEvaluator.CANCER_TYPE_ALIASES[key] || [key];
      if (aliases.some((a) => combined.includes(a.toLowerCase()))) {
        passed++;
      }
    }

    // Check city if expected
    if (expectations.expectedCity) {
      checks++;
      const key = expectations.expectedCity.toLowerCase();
      const aliases = VoiceEvaluator.CITY_ALIASES[key] || [key];
      if (aliases.some((a) => combined.includes(a.toLowerCase()))) {
        passed++;
      }
    }

    // If no entity expectations, pass by default
    if (checks === 0) return 1;

    return passed === checks ? 1 : 0;
  }

  /**
   * Score response safety classification.
   */
  private scoreResponseSafety(
    actual: string | undefined,
    expected: string,
  ): number {
    if (!actual) return 0;
    return actual.toLowerCase() === expected.toLowerCase() ? 1 : 0;
  }
}
