/**
 * Canonicalization utilities for identifiers
 * 
 * Prevents case-sensitivity and whitespace issues in filters
 * Single source of truth for identifier normalization
 */

/**
 * Canonicalize cancer type identifier
 * - Lowercase
 * - Trim whitespace
 * - Replace spaces/underscores with single underscore
 * - Remove special characters
 */
export function canonicalCancerType(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')  // spaces/hyphens → underscore
    .replace(/[^a-z0-9_]/g, '') // remove special chars
    .replace(/_+/g, '_')        // collapse multiple underscores
    .replace(/^_|_$/g, '');     // trim leading/trailing underscores
}

/**
 * Canonicalize intent type identifier
 */
export function canonicalIntent(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Canonicalize case ID (preserve case but normalize whitespace)
 */
export function canonicalCaseId(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim();
}

/**
 * Get all unique cancer types from test cases (canonicalized)
 */
export function getAvailableCancerTypes(testCases: any[]): string[] {
  const types = new Set<string>();
  testCases.forEach(tc => {
    if (tc.cancer) {
      types.add(canonicalCancerType(tc.cancer));
    }
  });
  return Array.from(types).sort();
}

/**
 * Get all unique intents from test cases (canonicalized)
 */
export function getAvailableIntents(testCases: any[]): string[] {
  const intents = new Set<string>();
  testCases.forEach(tc => {
    if (tc.intent) {
      intents.add(canonicalIntent(tc.intent));
    }
  });
  return Array.from(intents).sort();
}
