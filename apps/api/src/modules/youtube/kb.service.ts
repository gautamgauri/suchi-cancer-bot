import { Injectable, Logger } from "@nestjs/common";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { VideoTranscript } from "./youtube.service";

interface KbManifest {
  locale: string;
  schemaVersion: string;
  docs: KbDocument[];
}

interface KbDocument {
  id: string;
  title: string;
  version: string;
  status: string;
  source: string;
  sourceType: string;
  path: string;
  license: string;
  lastReviewed: string;
  reviewFrequency: string;
  audienceLevel: string;
  language: string;
  cancerTypes: string[];
  tags: string[];
  url: string;
  citation: string;
}

@Injectable()
export class KbService {
  private readonly logger = new Logger(KbService.name);
  private readonly kbRoot: string;

  constructor() {
    // Default to kb/ in project root, can be configured via env
    this.kbRoot = process.env.KB_ROOT || join(process.cwd(), "..", "..", "kb");
  }

  /**
   * Convert YouTube transcript to KB markdown format
   */
  async convertTranscriptToKb(transcript: VideoTranscript): Promise<string> {
    const metadata = this.extractMetadata(transcript.text);

    const markdown = `---
title: "${transcript.title}"
version: "v1"
status: "active"
source: "Suchi Cancer Care Foundation - Onco Talks"
video_id: "${transcript.videoId}"
---

# ${transcript.title}

**Source**: Onco Talks YouTube Channel
**Video URL**: https://www.youtube.com/watch?v=${transcript.videoId}
**Language**: ${transcript.language}
**Transcript Type**: Auto-generated

## Transcript

${transcript.text}

---
*This transcript is from the Onco Talks YouTube channel by Suchi Cancer Care Foundation.*
`;

    return markdown;
  }

  /**
   * Extract cancer types and tags from transcript text
   */
  private extractMetadata(text: string): { cancerTypes: string[]; tags: string[] } {
    const textLower = text.toLowerCase();

    // Detect cancer types
    const cancerTypes: string[] = [];
    const cancerKeywords: Record<string, string> = {
      'breast': 'breast',
      'lung': 'lung',
      'prostate': 'prostate',
      'colorectal': 'colorectal',
      'colon': 'colorectal',
      'pancreatic': 'pancreatic',
      'ovarian': 'ovarian',
      'leukemia': 'leukemia',
      'lymphoma': 'lymphoma',
      'melanoma': 'skin',
      'thyroid': 'thyroid',
      'liver': 'liver',
      'kidney': 'kidney',
      'stomach': 'stomach',
      'bladder': 'bladder'
    };

    for (const [keyword, cancerType] of Object.entries(cancerKeywords)) {
      if (textLower.includes(keyword) && !cancerTypes.includes(cancerType)) {
        cancerTypes.push(cancerType);
      }
    }

    if (cancerTypes.length === 0) {
      cancerTypes.push('general');
    }

    // Detect topics/tags
    const tags: string[] = [];
    const topicKeywords: Record<string, string> = {
      'treatment': 'treatment',
      'therapy': 'treatment',
      'chemotherapy': 'chemotherapy',
      'radiation': 'radiation-therapy',
      'surgery': 'surgery',
      'immunotherapy': 'immunotherapy',
      'screening': 'screening',
      'prevention': 'prevention',
      'symptom': 'symptoms',
      'diagnosis': 'diagnosis',
      'nutrition': 'nutrition',
      'side effect': 'side-effects',
      'caregiver': 'caregiver',
      'support': 'support',
      'palliative': 'palliative-care',
      'survivorship': 'survivorship'
    };

    for (const [keyword, tag] of Object.entries(topicKeywords)) {
      if (textLower.includes(keyword) && !tags.includes(tag)) {
        tags.push(tag);
      }
    }

    if (tags.length === 0) {
      tags.push('oncology', 'education');
    }

    return { cancerTypes, tags };
  }

  /**
   * Sanitize filename
   */
  private sanitizeFilename(text: string, maxLen: number = 50): string {
    // Remove special chars, convert to lowercase
    let safe = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '');
    safe = safe.replace(/\s+/g, '-');
    safe = safe.replace(/-+/g, '-');
    return safe.substring(0, maxLen).replace(/-+$/, '');
  }

  /**
   * Save transcript as KB markdown file and update manifest
   */
  async saveToKb(transcript: VideoTranscript): Promise<{ path: string; manifestEntry: KbDocument }> {
    try {
      // Determine language folder (default to 'en' if not recognized)
      const langFolder = ['hi', 'en'].includes(transcript.language) ? transcript.language : 'en';

      // Ensure output directory exists
      const outputDir = join(this.kbRoot, langFolder, "01_suchi_oncotalks");
      if (!existsSync(outputDir)) {
        await mkdir(outputDir, { recursive: true });
      }

      // Create markdown filename
      const filename = `${this.sanitizeFilename(transcript.title)}-${transcript.videoId}.md`;
      const filePath = join(outputDir, filename);

      // Generate markdown content
      const markdown = await this.convertTranscriptToKb(transcript);

      // Write markdown file
      await writeFile(filePath, markdown, "utf-8");
      this.logger.log(`Saved KB file: ${filePath}`);

      // Extract metadata for manifest
      const metadata = this.extractMetadata(transcript.text);

      // Determine language code (langFolder already defined above)
      const langCode = transcript.language === 'hi' ? 'hi' : 'en';

      // Create manifest entry
      const manifestEntry: KbDocument = {
        id: `kb_${langCode}_oncotalks_${transcript.videoId}_v1`,
        title: transcript.title,
        version: "v1",
        status: "active",
        source: `Suchi Cancer Care Foundation - Onco Talks (${langCode.toUpperCase()})`,
        sourceType: "01_suchi_oncotalks",
        path: `${langFolder}/01_suchi_oncotalks/${filename}`,
        license: "sccf_owned",
        lastReviewed: new Date().toISOString().split('T')[0],
        reviewFrequency: "annual",
        audienceLevel: "patient",
        language: langCode,
        cancerTypes: metadata.cancerTypes,
        tags: metadata.tags,
        url: `https://www.youtube.com/watch?v=${transcript.videoId}`,
        citation: `Onco Talks, SCCF, Video ID: ${transcript.videoId}`
      };

      return { path: filePath, manifestEntry };
    } catch (error) {
      this.logger.error(`Error saving to KB: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update manifest.json with new entries
   * Supports both English and Hindi manifests
   */
  async updateManifest(newEntries: KbDocument[]): Promise<void> {
    try {
      // Group entries by language
      const entriesByLang = new Map<string, KbDocument[]>();
      for (const entry of newEntries) {
        const lang = entry.language || 'en';
        if (!entriesByLang.has(lang)) {
          entriesByLang.set(lang, []);
        }
        entriesByLang.get(lang)!.push(entry);
      }

      // Update manifest for each language
      for (const [lang, entries] of entriesByLang.entries()) {
        const manifestPath = join(this.kbRoot, "manifest.json");

        // Read existing manifest
        let manifest: KbManifest;
        if (existsSync(manifestPath)) {
          const content = await readFile(manifestPath, "utf-8");
          manifest = JSON.parse(content);
        } else {
          manifest = {
            locale: lang,
            schemaVersion: "2.0",
            docs: []
          };
        }

        // Get existing IDs to avoid duplicates
        const existingIds = new Set(manifest.docs.map(doc => doc.id));

        // Add only new entries
        const uniqueNewEntries = entries.filter(entry => !existingIds.has(entry.id));

        if (uniqueNewEntries.length > 0) {
          manifest.docs.push(...uniqueNewEntries);

          // Write updated manifest
          await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
          this.logger.log(`Updated ${lang} manifest with ${uniqueNewEntries.length} new entries`);
        } else {
          this.logger.log(`No new entries to add to ${lang} manifest`);
        }
      }
    } catch (error) {
      this.logger.error(`Error updating manifest: ${error.message}`);
      throw error;
    }
  }

  /**
   * Batch process and save multiple transcripts
   */
  async batchSaveToKb(transcripts: VideoTranscript[]): Promise<{
    saved: number;
    skipped: number;
    errors: number;
    manifestEntries: KbDocument[];
  }> {
    let saved = 0;
    let skipped = 0;
    let errors = 0;
    const manifestEntries: KbDocument[] = [];

    for (const transcript of transcripts) {
      try {
        const { manifestEntry } = await this.saveToKb(transcript);
        manifestEntries.push(manifestEntry);
        saved++;
      } catch (error) {
        this.logger.error(`Failed to save ${transcript.videoId}: ${error.message}`);
        errors++;
      }
    }

    // Update manifest with all new entries at once
    if (manifestEntries.length > 0) {
      await this.updateManifest(manifestEntries);
    }

    return { saved, skipped, errors, manifestEntries };
  }
}
