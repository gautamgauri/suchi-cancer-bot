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

import { askedDiseaseSites, siteFamilyMembers } from "./disease-site-scope";

export interface CrossCancerTopic {
  keywords: string[];
  relatedCancerTypes: string[];
  queryEnhancements: string[];
  /**
   * Match Latin-script keywords as whole words only ("paan" must not match
   * "paani", water). Existing topics keep substring matching ("smoke" →
   * "smoker", "smokers").
   */
  wholeWords?: boolean;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hasTopicKeyword(lowerQuery: string, config: CrossCancerTopic): boolean {
  return config.keywords.some((kw) => {
    if (config.wholeWords && /^[a-z\s]+$/.test(kw)) {
      return new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(lowerQuery);
    }
    return lowerQuery.includes(kw);
  });
}

/**
 * Cross-cancer topics that span multiple cancer types.
 * These topics should retrieve from ALL relevant cancer types, not just the closest semantic match.
 */
export const CROSS_CANCER_TOPICS: Record<string, CrossCancerTopic> = {
  // Issue #170: chewed / smokeless tobacco (gutka, khaini, zarda, paan with
  // supari) must be checked BEFORE `smoking`, whose `tobacco` keyword would
  // otherwise claim it and fan retrieval out to `<query> lung cancer` and
  // `<query> bladder cancer` — the web repro retrieved 4x lung + 2x bladder and
  // no oral chunk for a chewing-tobacco question. Site order mirrors the KB
  // documents that cover this exposure (oral / head-and-neck PDQ, oral-cancer
  // local pages). Retrieval routing only — no patient-facing wording.
  smokeless_tobacco: {
    keywords: [
      'chewing tobacco',
      'chewed tobacco',
      'chew tobacco',
      'smokeless',
      'gutka',
      'gutkha',
      'khaini',
      'zarda',
      'paan',
      'supari',
      'betel',
      'areca',
      'snuff',
      'mawa',
      'tambaku chaba',
      'गुटखा',
      'खैनी',
      'ज़र्दा',
      'जर्दा',
      'सुपारी',
      'पान मसाला',
    ],
    relatedCancerTypes: ['oral', 'head and neck', 'esophageal'],
    queryEnhancements: [
      'smokeless tobacco oral cancer risk',
      'chewing tobacco mouth cancer prevention',
    ],
    wholeWords: true,
  },
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
    if (hasTopicKeyword(lowerQuery, config)) {
      // Issue #170: a question that NAMES its site ("does quitting tobacco lower
      // my oral cancer risk?") is not a cross-cancer question. Fanning it out
      // across the topic's site list put `lung` and `bladder` queries first and
      // answered a mouth question with lung content. Scope it to the named site
      // (and its clinical family) instead — unless the question explicitly asks
      // beyond that site ("other cancers besides lung cancer").
      const named = askedDiseaseSites(query);
      if (named.length > 0) {
        const scoped = Array.from(new Set(named.flatMap(siteFamilyMembers)));
        return {
          topic: topicName,
          cancerTypes: scoped,
          // The generic enhancements are site-agnostic but cigarette/lung-leaning
          // ("cigarette smoking cancer prevention"); a scoped question gets
          // only its own site queries.
          enhancements: [],
        };
      }
      return {
        topic: topicName,
        cancerTypes: config.relatedCancerTypes,
        enhancements: config.queryEnhancements,
      };
    }
  }

  return null;
}
