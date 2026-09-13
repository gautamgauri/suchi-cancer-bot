import { Injectable, Logger } from "@nestjs/common";
import { readFile, writeFile, mkdir, rename } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { VideoTranscript, MIN_TRANSCRIPT_CHARS } from "./youtube.service";
import { buildSections, renderSectionsMarkdown } from "./transcript-sections";

interface KbManifest {
  locale?: string;
  schemaVersion?: string;
  /** Present on the staging manifest only; see STAGED_MANIFEST_FILENAME. */
  staged?: boolean;
  note?: string;
  docs: KbDocument[];
}

/**
 * Human curation applied on top of a machine transcript.
 *
 * Section headings in particular are a REVIEW artefact, not model output: a
 * person reads the passage and gives it a topic label. They are committed to
 * `scripts/youtube-transcripts/curation.json` so every KB file here can be
 * regenerated and diffed.
 */
export interface CurationOverrides {
  /** Topic label per section, by index. Missing/blank entries stay unlabelled. */
  headings?: string[];
  /** Reviewer's note on transcription quality, rendered into the document. */
  qualityNote?: string;
  /** Overrides the video's own (often unhelpful) YouTube title. */
  title?: string;
  /** Overrides the derived filename stem. */
  slug?: string;
  cancerTypes?: string[];
  tags?: string[];
  audienceLevel?: string;
}

export interface KbDocument {
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
  /** Not read by ingest-kb.ts; carried for human reviewers. */
  reviewStatus?: string;
  captionTrack?: string;
  transcriptQuality?: string;
}

/**
 * Manifest that staged transcript entries are written to.
 *
 * `src/scripts/ingest-kb.ts:405` reads `<kbRoot>/manifest.json` and nothing
 * else, so entries parked in this file cannot be picked up by
 * `npm run kb:ingest`. Promoting a transcript into the KB is therefore an
 * explicit, reviewable move of an entry from this file into `manifest.json`,
 * never a side effect of running the ingest tooling.
 */
export const STAGED_MANIFEST_FILENAME = "manifest.oncotalks-pending.json";

@Injectable()
export class KbService {
  private readonly logger = new Logger(KbService.name);

  constructor() {
    // Intentionally no cached kbRoot: resolution is validated per call so a
    // misconfigured deployment fails loudly at write time rather than at boot.
  }

  /**
   * Resolve the KB root, and refuse anything that is not a real KB checkout.
   *
   * ISSUE #91 (b) — THE BUG THIS REPLACES
   * -------------------------------------
   * The old constructor did:
   *
   *     this.kbRoot = process.env.KB_ROOT || join(process.cwd(), "..", "..", "kb");
   *
   * Inside the Cloud Run container `process.cwd()/../../kb` is ephemeral scratch
   * space, not the git repo. Every transcript and every manifest edit written
   * there vanished on the next container restart, never reached version control,
   * and was never code-reviewed — while the endpoint reported success.
   *
   * KB content is reviewed material. It is only ever legitimate to write it into
   * a checkout that already contains `manifest.json`, so that is the test.
   */
  resolveKbRoot(): string {
    const configured = process.env.KB_ROOT;
    const candidate = resolve(configured || join(process.cwd(), "..", "..", "kb"));

    if (!existsSync(candidate)) {
      throw new Error(
        `KB root ${candidate} does not exist. Set KB_ROOT to a checkout of this repo's kb/ ` +
          `directory. Transcripts must be committed and reviewed, not written to container scratch.`,
      );
    }
    if (!existsSync(join(candidate, "manifest.json"))) {
      throw new Error(
        `KB root ${candidate} has no manifest.json, so it is not a KB checkout ` +
          `(on Cloud Run this path is ephemeral scratch). Refusing to write KB content there.`,
      );
    }
    return candidate;
  }

  /** True when this process is able to write reviewable KB content at all. */
  isKbRootWritable(): boolean {
    try {
      this.resolveKbRoot();
      return true;
    } catch {
      return false;
    }
  }

  /** Absolute path of the staging manifest. See STAGED_MANIFEST_FILENAME. */
  stagedManifestPath(): string {
    return join(this.resolveKbRoot(), STAGED_MANIFEST_FILENAME);
  }

  /**
   * Convert a transcript to KB markdown.
   *
   * Structured with `##` headings, one per ~900-character passage broken at a
   * sentence end or a pause. `ingest-kb.ts:130` splits documents on markdown
   * headings, so this is what makes a transcript chunk coherent instead of
   * being cut blind every 1,200 characters mid-sentence.
   */
  async convertTranscriptToKb(
    transcript: VideoTranscript,
    curation: CurationOverrides = {},
  ): Promise<string> {
    this.assertUsableTranscript(transcript);

    const title = curation.title ?? transcript.title;
    const sections = buildSections(transcript.segments, transcript.videoId).map((section) => ({
      ...section,
      heading: (curation.headings?.[section.index] ?? "").trim(),
    }));
    const body = renderSectionsMarkdown({
      videoId: transcript.videoId,
      title,
      language: transcript.language,
      captionTrack: transcript.captionTrack ?? transcript.language,
      machineGenerated: transcript.machineGenerated !== false,
      machineTranslated: transcript.machineTranslated === true,
      qualityNote: curation.qualityNote,
      sections,
    });

    const frontmatter = [
      "---",
      `title: "${title.replace(/"/g, '\\"')}"`,
      'version: "v1"',
      // Deliberately NOT "active": an uncorrected machine transcript must be
      // reviewed by a clinician before it can be retrieved. rag.service.ts
      // filters on `d.status = 'active'`, so this keeps it out of answers.
      'status: "inactive"',
      'reviewStatus: "pending"',
      'source: "Suchitra Cancer Care Foundation - Onco Talks"',
      `video_id: "${transcript.videoId}"`,
      `caption_track: "${transcript.captionTrack ?? transcript.language}"`,
      "---",
      "",
    ].join("\n");

    return frontmatter + body;
  }

  /**
   * ISSUE #91 (a), second half — there was no length guard anywhere.
   * An empty transcript produced an empty markdown file AND a manifest entry
   * pointing at it, corrupting `manifest.json` with a document that would be
   * chunked and embedded as nothing.
   */
  private assertUsableTranscript(transcript: VideoTranscript): void {
    if (!transcript) throw new Error("No transcript supplied");
    if (!Array.isArray(transcript.segments) || transcript.segments.length === 0) {
      throw new Error(`Transcript for ${transcript.videoId} has no segments; refusing to write a KB file`);
    }
    const length = (transcript.text ?? "").trim().length;
    if (length < MIN_TRANSCRIPT_CHARS) {
      throw new Error(
        `Transcript for ${transcript.videoId} is ${length} chars (minimum ${MIN_TRANSCRIPT_CHARS}); ` +
          `refusing to write a KB file or a manifest entry for it`,
      );
    }
    if (transcript.machineTranslated === true) {
      throw new Error(
        `Transcript for ${transcript.videoId} uses caption track "${transcript.captionTrack}", which is a ` +
          `machine TRANSLATION of a machine transcription. Two lossy machine steps stacked on medical ` +
          `content is not acceptable as KB evidence. Use the original-language track, or none.`,
      );
    }
  }

  /**
   * Extract cancer types and tags from transcript text
   */
  private extractMetadata(text: string): { cancerTypes: string[]; tags: string[] } {
    const textLower = text.toLowerCase();

    const cancerTypes: string[] = [];
    const cancerKeywords: Record<string, string> = {
      breast: "breast",
      lung: "lung",
      prostate: "prostate",
      colorectal: "colorectal",
      colon: "colorectal",
      pancreatic: "pancreatic",
      ovarian: "ovarian",
      leukemia: "leukemia",
      lymphoma: "lymphoma",
      melanoma: "skin",
      thyroid: "thyroid",
      liver: "liver",
      kidney: "kidney",
      stomach: "stomach",
      bladder: "bladder",
    };

    for (const [keyword, cancerType] of Object.entries(cancerKeywords)) {
      if (textLower.includes(keyword) && !cancerTypes.includes(cancerType)) {
        cancerTypes.push(cancerType);
      }
    }
    if (cancerTypes.length === 0) cancerTypes.push("general");

    const tags: string[] = [];
    const topicKeywords: Record<string, string> = {
      treatment: "treatment",
      therapy: "treatment",
      chemotherapy: "chemotherapy",
      radiation: "radiation-therapy",
      surgery: "surgery",
      immunotherapy: "immunotherapy",
      screening: "screening",
      prevention: "prevention",
      symptom: "symptoms",
      diagnosis: "diagnosis",
      nutrition: "nutrition",
      "side effect": "side-effects",
      caregiver: "caregiver",
      support: "support",
      palliative: "palliative-care",
      survivorship: "survivorship",
    };

    for (const [keyword, tag] of Object.entries(topicKeywords)) {
      if (textLower.includes(keyword) && !tags.includes(tag)) tags.push(tag);
    }
    if (tags.length === 0) tags.push("oncology", "education");

    return { cancerTypes, tags };
  }

  /**
   * Sanitize filename
   */
  private sanitizeFilename(text: string, maxLen: number = 50): string {
    let safe = text.toLowerCase().replace(/[^a-z0-9\s-]/g, "");
    safe = safe.replace(/\s+/g, "-");
    safe = safe.replace(/-+/g, "-");
    return safe.substring(0, maxLen).replace(/-+$/, "") || "transcript";
  }

  /**
   * Save transcript as KB markdown file and return its manifest entry.
   * Throws — and writes nothing — for an empty or machine-translated transcript.
   */
  async saveToKb(
    transcript: VideoTranscript,
    curation: CurationOverrides = {},
  ): Promise<{ path: string; manifestEntry: KbDocument }> {
    this.assertUsableTranscript(transcript);
    const kbRoot = this.resolveKbRoot();

    const title = curation.title ?? transcript.title;
    const langFolder = ["hi", "en"].includes(transcript.language) ? transcript.language : "en";
    const outputDir = join(kbRoot, langFolder, "01_suchi_oncotalks");
    if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });

    const filename = `${this.sanitizeFilename(curation.slug ?? title)}-${transcript.videoId}.md`;
    const filePath = join(outputDir, filename);

    const markdown = await this.convertTranscriptToKb(transcript, curation);
    await writeFile(filePath, markdown, "utf-8");
    this.logger.log(`Saved KB file: ${filePath}`);

    const metadata = this.extractMetadata(transcript.text);
    const langCode = langFolder;

    const manifestEntry: KbDocument = {
      id: `kb_${langCode}_oncotalks_${transcript.videoId}_v1`,
      title,
      version: "v1",
      // See convertTranscriptToKb: uncorrected ASR is not retrievable content.
      status: "inactive",
      reviewStatus: "pending",
      source: `Suchitra Cancer Care Foundation - Onco Talks (${langCode.toUpperCase()})`,
      sourceType: "01_suchi_oncotalks",
      path: `${langFolder}/01_suchi_oncotalks/${filename}`,
      license: "sccf_owned",
      lastReviewed: new Date().toISOString().split("T")[0],
      reviewFrequency: "annual",
      audienceLevel: curation.audienceLevel ?? "patient",
      language: langCode,
      cancerTypes: curation.cancerTypes ?? metadata.cancerTypes,
      tags: curation.tags ?? metadata.tags,
      url: `https://www.youtube.com/watch?v=${transcript.videoId}`,
      citation: `Onco Talks, SCCF, Video ID: ${transcript.videoId}`,
      captionTrack: transcript.captionTrack ?? transcript.language,
      transcriptQuality: curation.qualityNote ?? "machine-generated, uncorrected",
    };

    return { path: filePath, manifestEntry };
  }

  /**
   * Add entries to a manifest.
   *
   * Writes via a temp file + rename so an interrupted run cannot leave a
   * truncated `manifest.json` behind, and preserves `locale`/`schemaVersion`.
   *
   * `manifestPath` defaults to `KB_MANIFEST`, else the STAGING manifest
   * `<kbRoot>/manifest.oncotalks-pending.json` — deliberately NOT
   * `<kbRoot>/manifest.json`. `npm run kb:ingest` reads `kb/manifest.json`
   * unconditionally, so defaulting there would mean any accidental run of this
   * code put uncorrected machine transcripts one routine command away from
   * being chunked and embedded. Writing the live manifest requires naming it.
   */
  async updateManifest(newEntries: KbDocument[], manifestPath?: string): Promise<void> {
    if (newEntries.length === 0) {
      this.logger.log("No manifest entries to write");
      return;
    }

    const target = manifestPath || process.env.KB_MANIFEST || this.stagedManifestPath();

    const isStaged = target.endsWith(STAGED_MANIFEST_FILENAME);
    let manifest: KbManifest = isStaged
      ? {
          locale: "multi",
          schemaVersion: "2.0",
          staged: true,
          note:
            "STAGED — NOT INGESTED. Uncorrected machine transcripts awaiting SCCF medical review " +
            "(issue #91 D1-D5). ingest-kb.ts reads kb/manifest.json, not this file.",
          docs: [],
        }
      : { locale: "en", schemaVersion: "2.0", docs: [] };
    if (existsSync(target)) {
      manifest = JSON.parse(await readFile(target, "utf-8"));
      if (!Array.isArray(manifest.docs)) manifest.docs = [];
    }

    const existingIds = new Set(manifest.docs.map((doc) => doc.id));
    const uniqueNewEntries = newEntries.filter((entry) => !existingIds.has(entry.id));

    if (uniqueNewEntries.length === 0) {
      this.logger.log(`No new entries to add to ${target}`);
      return;
    }

    manifest.docs.push(...uniqueNewEntries);

    const tmp = `${target}.tmp`;
    await writeFile(tmp, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    await rename(tmp, target);
    this.logger.log(`Updated ${target} with ${uniqueNewEntries.length} new entries`);
  }

  /**
   * Batch process and save multiple transcripts.
   * A transcript that fails the usability guard is skipped, loudly, and never
   * reaches the manifest.
   */
  async batchSaveToKb(
    transcripts: VideoTranscript[],
    manifestPath?: string,
  ): Promise<{
    saved: number;
    skipped: number;
    errors: number;
    skippedReasons: Array<{ videoId: string; reason: string }>;
    manifestEntries: KbDocument[];
  }> {
    let saved = 0;
    let errors = 0;
    const skippedReasons: Array<{ videoId: string; reason: string }> = [];
    const manifestEntries: KbDocument[] = [];

    for (const transcript of transcripts) {
      try {
        const { manifestEntry } = await this.saveToKb(transcript);
        manifestEntries.push(manifestEntry);
        saved++;
      } catch (error) {
        this.logger.error(`Failed to save ${transcript?.videoId}: ${error.message}`);
        skippedReasons.push({ videoId: transcript?.videoId, reason: error.message });
        errors++;
      }
    }

    if (manifestEntries.length > 0) {
      await this.updateManifest(manifestEntries, manifestPath);
    }

    return { saved, skipped: skippedReasons.length, errors, skippedReasons, manifestEntries };
  }
}
