/**
 * ✅ Contract tests for canonicalization
 * 
 * Fast unit tests (<1s) that prevent regressions forever
 * Tests that filtering works correctly with case variations
 */

import {
  canonicalCancerType,
  canonicalIntent,
  canonicalCaseId,
} from './canonicalize';

describe('canonicalize', () => {
  describe('canonicalCancerType', () => {
    it('should normalize case variations', () => {
      expect(canonicalCancerType('LUNG')).toBe('lung');
      expect(canonicalCancerType('lung')).toBe('lung');
      expect(canonicalCancerType('Lung')).toBe('lung');
      expect(canonicalCancerType('  LUNG  ')).toBe('lung');
    });

    it('should handle underscores and hyphens', () => {
      expect(canonicalCancerType('non_hodgkin_lymphoma')).toBe('non_hodgkin_lymphoma');
      expect(canonicalCancerType('non-hodgkin-lymphoma')).toBe('non_hodgkin_lymphoma');
      expect(canonicalCancerType('NON HODGKIN LYMPHOMA')).toBe('non_hodgkin_lymphoma');
    });

    it('should handle edge cases', () => {
      expect(canonicalCancerType('')).toBe('');
      expect(canonicalCancerType(null as any)).toBe('');
      expect(canonicalCancerType(undefined as any)).toBe('');
    });
  });

  describe('canonicalIntent', () => {
    it('should normalize to uppercase', () => {
      expect(canonicalIntent('informational_general')).toBe('INFORMATIONAL_GENERAL');
      expect(canonicalIntent('INFORMATIONAL_GENERAL')).toBe('INFORMATIONAL_GENERAL');
      expect(canonicalIntent('Informational General')).toBe('INFORMATIONAL_GENERAL');
    });
  });

  describe('canonicalCaseId', () => {
    it('should preserve case but normalize whitespace', () => {
      expect(canonicalCaseId('SUCHI-T1-LUNG-GEN-01')).toBe('SUCHI-T1-LUNG-GEN-01');
      expect(canonicalCaseId('  SUCHI-T1-LUNG-GEN-01  ')).toBe('SUCHI-T1-LUNG-GEN-01');
    });
  });
});

/**
 * Integration test: Filter should work with case variations
 * 
 * This is the test that would have caught the "LUNG vs lung" bug
 */
describe('Filter Integration', () => {
  it('should match cancer types regardless of input case', () => {
    const testCases = [
      { id: '1', cancer: 'lung', intent: 'INFORMATIONAL_GENERAL', tier: 1 },
      { id: '2', cancer: 'breast', intent: 'INFORMATIONAL_GENERAL', tier: 1 },
    ];

    // Import here to avoid circular dependency
    const { Evaluator } = require('../runner/evaluator');

    // Should match regardless of filter case
    const result1 = Evaluator.filterTestCases(testCases, { cancer: 'LUNG' });
    const result2 = Evaluator.filterTestCases(testCases, { cancer: 'lung' });
    const result3 = Evaluator.filterTestCases(testCases, { cancer: 'Lung' });

    expect(result1.length).toBe(1);
    expect(result2.length).toBe(1);
    expect(result3.length).toBe(1);
    expect(result1[0].id).toBe('1');
    expect(result2[0].id).toBe('1');
    expect(result3[0].id).toBe('1');
  });
});
