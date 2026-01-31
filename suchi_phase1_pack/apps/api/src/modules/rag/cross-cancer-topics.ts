/**
 * Cross-Cancer Topics Module
 *
 * Detects queries about topics that span multiple cancer types (e.g., smoking, obesity, HPV)
 * and enables diversified retrieval across all relevant cancer types instead of just the
 * closest semantic match.
 *
 * Problem: A query like "does smoking cause other cancers besides lung cancer" would
 * semantically embed closest to lung cancer docs, missing bladder, pancreatic, etc.
 * This module detects such cross-cutting topics and triggers diversified retrieval.
 */

export interface CrossCancerTopic {
  keywords: string[];
  relatedCancerTypes: string[];
  queryEnhancements: string[];
}

/**
 * Cross-cancer topics that span multiple cancer types.
 * These topics should retrieve from ALL relevant cancer types, not just the closest semantic match.
 */
export const CROSS_CANCER_TOPICS: Record<string, CrossCancerTopic> = {
  smoking: {
    keywords: ['smoking', 'cigarette', 'tobacco', 'smoker', 'smoke'],
    relatedCancerTypes: [
      'lung',
      'bladder',
      'esophageal',
      'stomach',
      'pancreatic',
      'kidney',
      'cervical',
      'head and neck',
      'colorectal',
      'liver',
      'oral',
      'laryngeal',
    ],
    queryEnhancements: [
      'smoking risk factor cancer',
      'tobacco causes cancer types',
      'cigarette smoking cancer prevention',
    ],
  },
  obesity: {
    keywords: ['obesity', 'overweight', 'body weight', 'bmi', 'weight gain'],
    relatedCancerTypes: [
      'breast',
      'colorectal',
      'endometrial',
      'kidney',
      'pancreatic',
      'liver',
      'esophageal',
      'stomach',
      'ovarian',
    ],
    queryEnhancements: [
      'obesity risk factor cancer',
      'weight gain cancer risk',
      'overweight cancer prevention',
    ],
  },
  hpv: {
    keywords: ['hpv', 'human papillomavirus', 'papilloma'],
    relatedCancerTypes: [
      'cervical',
      'head and neck',
      'anal',
      'oropharyngeal',
      'penile',
      'vaginal',
      'vulvar',
    ],
    queryEnhancements: [
      'hpv related cancer',
      'hpv infection cancer risk',
      'human papillomavirus cancer prevention',
    ],
  },
  alcohol: {
    keywords: ['alcohol', 'drinking', 'alcoholic'],
    relatedCancerTypes: [
      'liver',
      'breast',
      'colorectal',
      'esophageal',
      'head and neck',
      'stomach',
    ],
    queryEnhancements: [
      'alcohol risk factor cancer',
      'drinking cancer risk',
      'alcohol related cancer types',
    ],
  },
};

export interface DetectedCrossCancerTopic {
  topic: string;
  cancerTypes: string[];
  enhancements: string[];
}

/**
 * Detect if a query is about a cross-cancer topic
 *
 * @param query The user's query
 * @returns The detected topic with related cancer types and query enhancements, or null
 */
export function detectCrossCancerTopic(query: string): DetectedCrossCancerTopic | null {
  const lowerQuery = query.toLowerCase();

  for (const [topicName, config] of Object.entries(CROSS_CANCER_TOPICS)) {
    const hasKeyword = config.keywords.some((kw) => lowerQuery.includes(kw));
    if (hasKeyword) {
      return {
        topic: topicName,
        cancerTypes: config.relatedCancerTypes,
        enhancements: config.queryEnhancements,
      };
    }
  }

  return null;
}
