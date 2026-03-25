import { Injectable, Logger } from '@nestjs/common';
import type { ReviewMetrics, FailureFinding, FailureModeId } from '../copilot.types';

@Injectable()
export class FailureClassifierService {
  private readonly logger = new Logger(FailureClassifierService.name);

  /** Classify failures from review metrics and response text */
  classify(
    metrics: ReviewMetrics,
    responseText: string,
    citations: any[],
  ): FailureFinding[] {
    const findings: FailureFinding[] = [];
    let seq = 0;

    // Safety violations (critical)
    if (metrics.safetyScore < 1.0) {
      findings.push({
        id: `FF-${++seq}`,
        mode: 'unsafe_medical_claim',
        severity: 'critical',
        evidence: 'Response contains diagnosis, prognosis, or dosage claims',
      });
    }

    // Missing disclaimer (major)
    if (!metrics.disclaimerPresent) {
      findings.push({
        id: `FF-${++seq}`,
        mode: 'missing_disclaimer',
        severity: 'major',
        evidence: 'No medical disclaimer found in response',
      });
    }

    // No citations (major)
    if (metrics.citationScore === 0) {
      findings.push({
        id: `FF-${++seq}`,
        mode: 'unsupported_claim',
        severity: 'major',
        evidence: 'Response has no citations or KB-backed evidence',
      });
    }

    // Citation fabrication check — inline citation refs without matching retrieved chunks
    const inlineRefs = responseText.match(/\[citation:([^\]]+)\]/g) ?? [];
    if (inlineRefs.length > 0 && (!citations || citations.length === 0)) {
      findings.push({
        id: `FF-${++seq}`,
        mode: 'citation_fabrication',
        severity: 'critical',
        evidence: `${inlineRefs.length} inline citation(s) found but no retrieved chunks to back them`,
      });
    }

    // Incomplete coverage (minor)
    if (metrics.completenessScore < 0.6) {
      findings.push({
        id: `FF-${++seq}`,
        mode: 'incomplete_coverage',
        severity: 'minor',
        evidence: 'Response appears too brief or incomplete for the query',
      });
    }

    // Inappropriate tone (major)
    if (metrics.toneScore < 1.0) {
      findings.push({
        id: `FF-${++seq}`,
        mode: 'inappropriate_tone',
        severity: 'major',
        evidence: 'Response contains alarming or insensitive language',
      });
    }

    return findings;
  }
}
