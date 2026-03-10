#!/usr/bin/env node

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ApiClient } from './api-client';

/**
 * Voice Transcript Eval — sends voice-style cancer queries (text, simulating
 * Web Speech API transcription) to /v1/chat and captures full input/output
 * transcripts with timing, safety, and quality signals.
 *
 * This tests the same path the React frontend uses:
 *   mic → Web Speech API → text → onSend(text) → POST /v1/chat
 */

// ── Types ────────────────────────────────────────────────────────────

interface VoiceTranscriptCase {
  id: string;
  cancer: string;
  intent: string;
  channel: string;
  voice_input: string;
  expectations: {
    must_mention?: string[];
    must_mention_any?: string[];
    safety: string;
    max_response_time_ms: number;
  };
}

interface TranscriptResult {
  caseId: string;
  cancer: string;
  intent: string;
  voiceInput: string;
  responseText: string;
  safety: {
    classification: string;
    actions: string[];
  };
  citations: number;
  citationConfidence?: string;
  responseTimeMs: number;
  passed: boolean;
  checks: {
    mustMention: { expected: string[]; found: string[]; missing: string[]; pass: boolean };
    mustMentionAny?: { expected: string[]; found: string[]; pass: boolean };
    safetyMatch: boolean;
    withinLatency: boolean;
  };
  sessionId: string;
}

interface TranscriptReport {
  runId: string;
  timestamp: string;
  apiBaseUrl: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    avgResponseTimeMs: number;
    totalExecutionTimeMs: number;
  };
  transcripts: TranscriptResult[];
  improvements: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function checkMustMention(text: string, keywords: string[]): { found: string[]; missing: string[] } {
  const lower = text.toLowerCase();
  const found: string[] = [];
  const missing: string[] = [];
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      found.push(kw);
    } else {
      missing.push(kw);
    }
  }
  return { found, missing };
}

function checkMustMentionAny(text: string, keywords: string[]): { found: string[]; pass: boolean } {
  const lower = text.toLowerCase();
  const found = keywords.filter(kw => lower.includes(kw.toLowerCase()));
  return { found, pass: found.length > 0 };
}

function deriveImprovements(results: TranscriptResult[]): string[] {
  const improvements: string[] = [];
  const failedCases = results.filter(r => !r.passed);

  // Safety mismatches
  const safetyFails = results.filter(r => !r.checks.safetyMatch);
  if (safetyFails.length > 0) {
    improvements.push(
      `Safety classification mismatch in ${safetyFails.length} case(s): ${safetyFails.map(r => r.caseId).join(', ')}. Review safety module thresholds.`
    );
  }

  // Latency issues
  const slowCases = results.filter(r => !r.checks.withinLatency);
  if (slowCases.length > 0) {
    const avgSlow = Math.round(slowCases.reduce((s, r) => s + r.responseTimeMs, 0) / slowCases.length);
    improvements.push(
      `${slowCases.length} case(s) exceeded latency target (avg ${avgSlow}ms): ${slowCases.map(r => r.caseId).join(', ')}. Consider LLM timeout tuning or response caching.`
    );
  }

  // Missing medical terms
  const mentionFails = results.filter(r => !r.checks.mustMention.pass);
  if (mentionFails.length > 0) {
    const allMissing = new Set<string>();
    mentionFails.forEach(r => r.checks.mustMention.missing.forEach(m => allMissing.add(m)));
    improvements.push(
      `${mentionFails.length} case(s) missing expected medical terms: [${[...allMissing].join(', ')}]. Review KB coverage and RAG retrieval for these topics.`
    );
  }

  // No citations
  const noCitations = results.filter(r => r.citations === 0);
  if (noCitations.length > 0) {
    improvements.push(
      `${noCitations.length} case(s) returned 0 citations: ${noCitations.map(r => r.caseId).join(', ')}. Check KB ingestion and embedding similarity thresholds.`
    );
  }

  // Hindi/Hinglish handling
  const hindiCases = results.filter(r => r.voiceInput.match(/[a-z]+\s+(ke|mein|ka|ki|hai|kya)\b/i));
  const hindiFails = hindiCases.filter(r => !r.passed);
  if (hindiFails.length > 0) {
    improvements.push(
      `Hindi/Hinglish query handling needs improvement: ${hindiFails.map(r => r.caseId).join(', ')}. Consider adding Hindi KB content or improving multilingual retrieval.`
    );
  }

  if (improvements.length === 0 && failedCases.length === 0) {
    improvements.push('All cases passed. Voice transcript pipeline is working correctly.');
  }

  return improvements;
}

// ── Main Runner ──────────────────────────────────────────────────────

export async function runVoiceTranscriptEval(opts: {
  casesPath: string;
  apiBaseUrl: string;
  outputPath: string;
  timeoutMs?: number;
  authBearer?: string;
  summary?: boolean;
}): Promise<TranscriptReport> {
  const { casesPath, apiBaseUrl, outputPath, timeoutMs = 60000, authBearer, summary } = opts;

  // Load cases
  const content = await fs.readFile(casesPath, 'utf-8');
  const parsed = yaml.load(content) as { cases: VoiceTranscriptCase[] };
  const cases = parsed.cases || [];
  console.log(`Loaded ${cases.length} voice transcript test cases`);

  const client = new ApiClient(apiBaseUrl, timeoutMs, authBearer, 2);

  // Warm up
  console.log('\nWarming up API...');
  await client.warmUp(2);

  const runStart = Date.now();
  const results: TranscriptResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    console.log(`\n[${i + 1}/${cases.length}] ${tc.id}: "${tc.voice_input.substring(0, 60)}..."`);

    const caseStart = Date.now();
    try {
      // Create session with cancer context (mirrors what web frontend does)
      const sessionId = await client.createSession('web', tc.cancer);

      // Send the voice transcript as text — same as MessageInput.onSend()
      const response = await client.sendMessage(sessionId, tc.voice_input, 'web');
      const responseTimeMs = Date.now() - caseStart;

      // Check expectations
      const mustMentionResult = tc.expectations.must_mention
        ? checkMustMention(response.responseText, tc.expectations.must_mention)
        : { found: [], missing: [] };
      const mustMentionPass = tc.expectations.must_mention
        ? mustMentionResult.missing.length === 0
        : true;

      let mustMentionAnyResult: { found: string[]; pass: boolean } | undefined;
      if (tc.expectations.must_mention_any) {
        mustMentionAnyResult = checkMustMentionAny(response.responseText, tc.expectations.must_mention_any);
      }

      const safetyMatch = response.safety?.classification === tc.expectations.safety;
      const withinLatency = responseTimeMs <= tc.expectations.max_response_time_ms;

      const passed = mustMentionPass
        && (mustMentionAnyResult ? mustMentionAnyResult.pass : true)
        && safetyMatch
        && withinLatency;

      const result: TranscriptResult = {
        caseId: tc.id,
        cancer: tc.cancer,
        intent: tc.intent,
        voiceInput: tc.voice_input,
        responseText: response.responseText,
        safety: response.safety || { classification: 'unknown', actions: [] },
        citations: response.citations?.length || 0,
        citationConfidence: response.citationConfidence,
        responseTimeMs,
        passed,
        checks: {
          mustMention: {
            expected: tc.expectations.must_mention || [],
            found: mustMentionResult.found,
            missing: mustMentionResult.missing,
            pass: mustMentionPass,
          },
          ...(mustMentionAnyResult ? { mustMentionAny: { expected: tc.expectations.must_mention_any!, found: mustMentionAnyResult.found, pass: mustMentionAnyResult.pass } } : {}),
          safetyMatch,
          withinLatency,
        },
        sessionId: response.sessionId,
      };

      results.push(result);
      const status = passed ? 'PASS' : 'FAIL';
      console.log(`  ${status} | ${responseTimeMs}ms | safety=${response.safety?.classification} | citations=${result.citations}`);
      if (!mustMentionPass) {
        console.log(`  Missing terms: ${mustMentionResult.missing.join(', ')}`);
      }
    } catch (err: any) {
      const responseTimeMs = Date.now() - caseStart;
      console.log(`  ERROR: ${err.message}`);
      results.push({
        caseId: tc.id,
        cancer: tc.cancer,
        intent: tc.intent,
        voiceInput: tc.voice_input,
        responseText: `[ERROR] ${err.message}`,
        safety: { classification: 'error', actions: [] },
        citations: 0,
        responseTimeMs,
        passed: false,
        checks: {
          mustMention: { expected: tc.expectations.must_mention || [], found: [], missing: tc.expectations.must_mention || [], pass: false },
          safetyMatch: false,
          withinLatency: false,
        },
        sessionId: '',
      });
    }
  }

  const totalExecutionTimeMs = Date.now() - runStart;
  const passedCount = results.filter(r => r.passed).length;
  const avgResponseTimeMs = Math.round(results.reduce((s, r) => s + r.responseTimeMs, 0) / results.length);

  const improvements = deriveImprovements(results);

  const report: TranscriptReport = {
    runId: `vt-${Date.now()}`,
    timestamp: new Date().toISOString(),
    apiBaseUrl,
    summary: {
      total: results.length,
      passed: passedCount,
      failed: results.length - passedCount,
      passRate: passedCount / results.length,
      avgResponseTimeMs,
      totalExecutionTimeMs,
    },
    transcripts: results,
    improvements,
  };

  // Save report
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nReport saved to: ${outputPath}`);

  // Print summary
  if (summary) {
    console.log('\n' + '='.repeat(70));
    console.log('VOICE TRANSCRIPT EVAL — RESULTS');
    console.log('='.repeat(70));
    console.log(`Total: ${report.summary.total} | Passed: ${report.summary.passed} | Failed: ${report.summary.failed} | Pass Rate: ${(report.summary.passRate * 100).toFixed(0)}%`);
    console.log(`Avg Response Time: ${report.summary.avgResponseTimeMs}ms | Total: ${(report.summary.totalExecutionTimeMs / 1000).toFixed(1)}s`);

    console.log('\n--- Transcripts ---');
    for (const r of results) {
      const status = r.passed ? 'PASS' : 'FAIL';
      console.log(`\n[${status}] ${r.caseId} (${r.cancer} / ${r.intent})`);
      console.log(`  Voice Input:  "${r.voiceInput}"`);
      console.log(`  Response:     "${r.responseText.substring(0, 200)}${r.responseText.length > 200 ? '...' : ''}"`);
      console.log(`  Safety: ${r.safety.classification} | Citations: ${r.citations} | Time: ${r.responseTimeMs}ms`);
      if (!r.checks.mustMention.pass) {
        console.log(`  Missing: ${r.checks.mustMention.missing.join(', ')}`);
      }
    }

    if (improvements.length > 0) {
      console.log('\n--- Improvement Areas ---');
      improvements.forEach((imp, i) => console.log(`  ${i + 1}. ${imp}`));
    }
    console.log('\n' + '='.repeat(70));
  }

  return report;
}
