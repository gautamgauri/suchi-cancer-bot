import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

interface SynonymMapping {
  [conceptId: string]: {
    preferred: string;
    synonyms: string[];
  };
}

@Injectable()
export class SynonymService {
  private readonly logger = new Logger(SynonymService.name);
  private synonymMapping: SynonymMapping | null = null;
  private reverseMapping: Map<string, string[]> = new Map(); // term -> concept IDs

  constructor() {
    this.loadSynonyms();
  }

  private loadSynonyms(): void {
    try {
      // Try multiple possible paths
      const possiblePaths = [
        path.join(process.cwd(), "../../kb/en/02_nci_core/ncit/ncit-synonyms.json"),
        path.join(process.cwd(), "kb/en/02_nci_core/ncit/ncit-synonyms.json"),
        path.join(__dirname, "../../../../kb/en/02_nci_core/ncit/ncit-synonyms.json"),
        path.resolve(process.cwd(), "..", "..", "kb", "en", "02_nci_core", "ncit", "ncit-synonyms.json")
      ];

      let ncitPath: string | null = null;
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          ncitPath = possiblePath;
          break;
        }
      }

      if (ncitPath) {
        const content = fs.readFileSync(ncitPath, "utf-8");
        this.synonymMapping = JSON.parse(content);

        // Build reverse mapping: term -> concept IDs
        this.reverseMapping.clear();
        if (this.synonymMapping) {
          for (const [conceptId, data] of Object.entries(this.synonymMapping)) {
            const allTerms = [data.preferred.toLowerCase(), ...data.synonyms.map((s) => s.toLowerCase())];
            for (const term of allTerms) {
              if (!this.reverseMapping.has(term)) {
                this.reverseMapping.set(term, []);
              }
              this.reverseMapping.get(term)!.push(conceptId);
            }
          }
        }

        const mappingSize = this.synonymMapping ? Object.keys(this.synonymMapping).length : 0;
        this.logger.log(`Loaded ${mappingSize} NCIt concept mappings with ${this.reverseMapping.size} terms`);
      } else {
        this.logger.warn(`NCIt synonyms file not found at ${ncitPath}. Synonym expansion disabled.`);
      }
    } catch (error) {
      this.logger.error(`Error loading NCIt synonyms: ${error.message}`);
    }
  }

  /**
   * Expand query terms with synonyms from NCIt
   */
  expandQuery(query: string): string[] {
    if (!this.reverseMapping.size) {
      return [query]; // No synonyms loaded, return original
    }

    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
    const expandedTerms = new Set<string>();
    expandedTerms.add(query); // Always include original query

    for (const term of terms) {
      // Add original term
      expandedTerms.add(term);

      // Find synonyms
      const conceptIds = this.reverseMapping.get(term);
      if (conceptIds && this.synonymMapping) {
        for (const conceptId of conceptIds) {
          const concept = this.synonymMapping[conceptId];
          if (concept) {
            // Add preferred term and all synonyms
            expandedTerms.add(concept.preferred.toLowerCase());
            for (const synonym of concept.synonyms) {
              expandedTerms.add(synonym.toLowerCase());
            }
          }
        }
      }

      // Also check partial matches (e.g., "colon" matches "colorectal")
      for (const [synonymTerm, ids] of this.reverseMapping.entries()) {
        if (synonymTerm.includes(term) || term.includes(synonymTerm)) {
          for (const conceptId of ids) {
            const concept = this.synonymMapping![conceptId];
            if (concept) {
              expandedTerms.add(concept.preferred.toLowerCase());
              concept.synonyms.forEach((s) => expandedTerms.add(s.toLowerCase()));
            }
          }
        }
      }
    }

    return Array.from(expandedTerms);
  }

  /**
   * Get preferred term for a given term (if exists)
   */
  getPreferredTerm(term: string): string | null {
    if (!this.reverseMapping.size) {
      return null;
    }

    const lowerTerm = term.toLowerCase();
    const conceptIds = this.reverseMapping.get(lowerTerm);

    if (conceptIds && conceptIds.length > 0 && this.synonymMapping) {
      // Return preferred term from first concept
      const concept = this.synonymMapping[conceptIds[0]];
      return concept ? concept.preferred : null;
    }

    return null;
  }

  /**
   * Check if synonyms are loaded
   */
  isLoaded(): boolean {
    return this.synonymMapping !== null && this.reverseMapping.size > 0;
  }
}
