/**
 * Trusted Sources Configuration
 * 
 * Defines approved source types and their rules for evidence validation.
 * Only sources listed here will be considered trustworthy for medical claims.
 */

export type SourcePriority = 'high' | 'medium' | 'low';
export type QueryType = 'prevention' | 'screening' | 'treatment' | 'sideEffects' | 'caregiver' | 'navigation' | 'general';

export interface SourceConfig {
  priority: SourcePriority;
  requiresRecency: boolean;
  maxAgeMonths?: number; // Maximum age in months before requiring update
}

export interface EvidenceThresholds {
  minPassages: number;
  minSources: number;
}

/**
 * Approved source types and their validation rules
 */
export const TRUSTED_SOURCES: Record<string, SourceConfig> = {
  '01_suchi_oncotalks': {
    priority: 'high',
    requiresRecency: false, // Owned content, doesn't need frequent updates
  },
  '02_nci_core': {
    priority: 'high',
    requiresRecency: false, // NCI content is stable
  },
  '03_who_public_health': {
    priority: 'high',
    requiresRecency: true,
    maxAgeMonths: 24, // WHO guidelines should be within 2 years
  },
  '04_iarc_stats': {
    priority: 'medium',
    requiresRecency: true,
    maxAgeMonths: 60, // Stats are stable but should be updated periodically
  },
  '05_india_ncg': {
    priority: 'high',
    requiresRecency: true,
    maxAgeMonths: 18, // Clinical guidelines should be recent
  },
  '06_pmc_selective': {
    priority: 'medium',
    requiresRecency: true,
    maxAgeMonths: 36, // Research articles can be older but should be recent for treatment
  },
  '99_local_navigation': {
    priority: 'high',
    requiresRecency: true,
    maxAgeMonths: 12, // Local resources should be kept current
  },
} as const;

/**
 * Evidence thresholds by query type
 * Defines minimum requirements for evidence quality before allowing a response
 */
export const EVIDENCE_THRESHOLDS: Record<QueryType, EvidenceThresholds> = {
  treatment: {
    minPassages: 2,
    minSources: 2, // Treatment info requires multiple sources
  },
  sideEffects: {
    minPassages: 2,
    minSources: 1, // Side effects can come from single authoritative source
  },
  prevention: {
    minPassages: 1,
    minSources: 1, // Prevention info is generally well-established
  },
  screening: {
    minPassages: 2,
    minSources: 1, // Screening guidelines should be authoritative
  },
  caregiver: {
    minPassages: 1,
    minSources: 1,
  },
  navigation: {
    minPassages: 1,
    minSources: 1,
  },
  general: {
    minPassages: 1,
    minSources: 1,
  },
};

/**
 * Check if a source type is trusted
 */
export function isTrustedSource(sourceType: string | null | undefined): boolean {
  if (!sourceType) return false;
  return sourceType in TRUSTED_SOURCES;
}

/**
 * Get configuration for a source type
 */
export function getSourceConfig(sourceType: string | null | undefined): SourceConfig | null {
  if (!sourceType || !isTrustedSource(sourceType)) return null;
  return TRUSTED_SOURCES[sourceType];
}

/**
 * Get evidence thresholds for a query type
 */
export function getEvidenceThresholds(queryType: QueryType): EvidenceThresholds {
  return EVIDENCE_THRESHOLDS[queryType];
}










