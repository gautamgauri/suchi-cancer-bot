import { Injectable, Logger } from '@nestjs/common';

export interface QueryExpansion {
  original: string;
  expanded: string[];
  synonyms: Map<string, string[]>;
}

/**
 * PHASE 3: Query Expansion Service
 * Maps colloquial patient terms to medical terminology for better retrieval
 * Addresses symptom terminology gaps (e.g., "bloating" → "abdominal distension")
 */
@Injectable()
export class QueryExpanderService {
  private readonly logger = new Logger(QueryExpanderService.name);

  // Common patient terms → medical terms mapping
  private readonly SYMPTOM_SYNONYMS = new Map<string, string[]>([
    // Ovarian/abdominal symptoms
    ['bloating', ['abdominal distension', 'swelling', 'bloated', 'distended abdomen']],
    ['pelvic pain', ['pelvic discomfort', 'lower abdominal pain', 'pelvic pressure']],
    
    // General systemic symptoms
    ['tired', ['fatigue', 'tiredness', 'exhaustion', 'low energy', 'lethargy']],
    ['weight loss', ['unintentional weight loss', 'cachexia', 'wasting']],
    ['night sweats', ['nocturnal hyperhidrosis', 'excessive sweating at night']],
    
    // Urinary symptoms
    ['frequent urination', ['urinary frequency', 'dysuria', 'urinary urgency', 'polyuria']],
    
    // Gastrointestinal symptoms
    ['difficulty swallowing', ['dysphagia', 'swallowing problems', 'odynophagia']],
    
    // Respiratory symptoms
    ['shortness of breath', ['dyspnea', 'breathlessness', 'difficulty breathing']],
    
    // General terms
    ['early warning signs', ['signs and symptoms', 'symptoms', 'signs', 'clinical presentation', 'warning signs']],
    ['warning signs', ['signs and symptoms', 'symptoms', 'signs', 'clinical presentation']],

    // Cancer-specific symptom phrases (match NCI PDQ language)
    ['signs of', ['signs and symptoms of', 'symptoms of']],
  ]);

  /**
   * Expand query with medical synonyms for better retrieval
   * Only expands for symptom/general queries (not urgent/personal)
   */
  expandQuery(query: string, intent: string): QueryExpansion {
    const expanded: string[] = [query]; // Always include original
    const matchedSynonyms = new Map<string, string[]>();

    // Only expand for symptom/general queries
    // Don't expand for urgent/personal queries (keep user's exact language)
    if (intent !== 'INFORMATIONAL_GENERAL' && intent !== 'INFORMATIONAL_SYMPTOMS' && intent !== 'PREVENTION_SCREENING_INFO') {
      return { original: query, expanded, synonyms: matchedSynonyms };
    }

    const lowerQuery = query.toLowerCase();

    // Find matching terms and add synonyms
    for (const [term, synonyms] of this.SYMPTOM_SYNONYMS.entries()) {
      if (lowerQuery.includes(term)) {
        matchedSynonyms.set(term, synonyms);
        
        // Create expanded queries with synonyms
        // Use top 2 synonyms to avoid over-expansion
        synonyms.slice(0, 2).forEach(synonym => {
          const expandedQuery = lowerQuery.replace(term, synonym);
          expanded.push(expandedQuery);
        });
      }
    }

    // Log expansion for observability
    if (expanded.length > 1) {
      this.logger.log({
        event: 'query_expansion',
        original: query,
        expandedCount: expanded.length,
        synonymsMatched: Array.from(matchedSynonyms.keys()),
      });
    }

    return { original: query, expanded, synonyms: matchedSynonyms };
  }

  /**
   * Deduplicate chunks by chunkId (helper for RAG service)
   */
  deduplicateChunks<T extends { chunkId: string }>(chunks: T[]): T[] {
    const seen = new Set<string>();
    const unique: T[] = [];

    for (const chunk of chunks) {
      if (!seen.has(chunk.chunkId)) {
        seen.add(chunk.chunkId);
        unique.push(chunk);
      }
    }

    return unique;
  }
}
