/**
 * Transcript → KB section builder.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/scripts/ingest-kb.ts` chunks a KB document by splitting on markdown
 * headings (`chunkMarkdown`, ingest-kb.ts:130) and only falls back to a blind
 * fixed-width cut when a heading section is still too long.
 *
 * A raw caption dump has no headings, so every transcript would take that blind
 * path and be cut every ~1,200 characters — chunks that routinely start and end
 * mid-sentence. Retrieval hands a chunk to the model verbatim as evidence, so a
 * mid-sentence chunk is materially worse evidence than a coherent one.
 *
 * This module turns timed caption segments into headed sections sized so that
 * one section ≈ one retrieval chunk, and stamps each heading with the video
 * timestamp plus a `?t=` deep link so the text of the chunk itself carries the
 * means to verify it (see CITATIONS below).
 *
 * CITATIONS
 * ---------
 * `KbChunk` has no time-offset column and `MessageCitation` does not persist the
 * source document URL, so the database cannot today express "this claim came
 * from 12:04 of video X". Until that schema gap is closed, the deep link is
 * embedded in the chunk *content*, which does survive into retrieval. That is a
 * workaround, not the fix — see the PR body / issue #91 §5.
 */

export interface TranscriptSegment {
  text: string;
  /** Seconds from the start of the video. */
  start: number;
  /** Seconds. May be 0 for sources that do not report it. */
  duration?: number;
}

export interface TranscriptSection {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  /** `MM:SS` or `H:MM:SS`. */
  timestamp: string;
  /** Deep link that opens the video at `startSeconds`. */
  deepLink: string;
  /** Short topic label. Empty until a human supplies one. */
  heading: string;
}

export interface BuildSectionsOptions {
  /** Preferred section size in characters. Default 900. */
  targetChars?: number;
  /** Hard ceiling before a section is force-closed. Default 1200. */
  maxChars?: number;
  /** A silence at least this long is a preferred break point. Default 1.0s. */
  pauseSeconds?: number;
  /** Sections shorter than this are merged into the previous one. Default 200. */
  minChars?: number;
}

const DEFAULTS: Required<BuildSectionsOptions> = {
  targetChars: 900,
  maxChars: 1200,
  pauseSeconds: 1.0,
  minChars: 200,
};

/**
 * Non-speech caption cues, e.g. `[Music]`, `[Applause]`, `[संगीत]`, `[प्रशंसा]`.
 * These carry no information and pollute both embeddings and reading.
 */
const NON_SPEECH_CUE = /\[[^\]\n]{0,40}\]/g;

/** YouTube's transcript panel marks speaker turns with `>>`. */
const SPEAKER_ARROW = /(^|\s)>>+\s*/g;

/**
 * Filler tokens that add length without meaning. Conservative on purpose.
 *
 * NOT applied when rendering KB markdown. These documents exist to be checked
 * against the recording by a human, so the body stays verbatim: a reviewer
 * comparing text to audio must not have to wonder whether a discrepancy is an
 * ASR error or something this tool removed. Exposed for callers that want a
 * cleaned copy for other purposes.
 */
const FILLERS = [
  /\b(?:uh|um|erm|mhm|hmm|uh-huh)\b/gi,
  /\byou know\b/gi,
];

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** VTT cues arrive HTML-escaped, so `>>` speaker turns look like `&gt;&gt;`. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => HTML_ENTITIES[m] ?? m);
}

export function cleanSegmentText(raw: string): string {
  let t = raw ?? "";
  t = t.replace(/\r/g, " ");
  // Decode twice: YouTube double-escapes (`&amp;gt;`) in some caption tracks.
  t = decodeHtmlEntities(decodeHtmlEntities(t));
  t = t.replace(NON_SPEECH_CUE, " ");
  t = t.replace(SPEAKER_ARROW, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

export function stripFillers(text: string): string {
  let t = text;
  for (const f of FILLERS) t = t.replace(f, " ");
  // Tidy up the punctuation left behind by removed fillers.
  t = t.replace(/\s+([,.?!])/g, "$1");
  t = t.replace(/([,.?!])\1+/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/**
 * YouTube auto-captions overlap: a rolling caption repeats the tail of the
 * previous cue. Left in, the same sentence is embedded two or three times.
 */
export function dedupeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const seg of segments) {
    const text = cleanSegmentText(seg.text);
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev) {
      if (prev.text === text) continue;
      // Rolling caption: the new cue is the previous one plus more.
      if (text.startsWith(prev.text) && text.length > prev.text.length) {
        out[out.length - 1] = { ...prev, text };
        continue;
      }
      if (prev.text.startsWith(text)) continue;
    }
    out.push({ text, start: seg.start, duration: seg.duration ?? 0 });
  }
  return out;
}

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function buildDeepLink(videoId: string, startSeconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(startSeconds))}s`;
}

/** Sentence-final punctuation for Latin and Devanagari scripts. */
const SENTENCE_END = /[.?!।॥]$/;

/**
 * Group timed caption segments into coherent, heading-sized sections.
 *
 * Break preference, highest first:
 *   1. at or past `targetChars` AND at a sentence end
 *   2. at or past `targetChars` AND after a pause of `pauseSeconds`
 *   3. `maxChars` reached (forced)
 */
export function buildSections(
  segments: TranscriptSegment[],
  videoId: string,
  options: BuildSectionsOptions = {},
): TranscriptSection[] {
  const opts = { ...DEFAULTS, ...options };
  const clean = dedupeSegments(segments);
  if (clean.length === 0) return [];

  type Draft = { start: number; end: number; parts: string[]; chars: number };
  const drafts: Draft[] = [];
  let cur: Draft | null = null;

  for (let i = 0; i < clean.length; i++) {
    const seg = clean[i];
    const segEnd = seg.start + (seg.duration ?? 0);
    if (!cur) cur = { start: seg.start, end: segEnd, parts: [], chars: 0 };

    cur.parts.push(seg.text);
    cur.chars += seg.text.length + 1;
    cur.end = Math.max(cur.end, segEnd);

    const next = clean[i + 1];
    const gap = next ? next.start - cur.end : Infinity;
    const atSentenceEnd = SENTENCE_END.test(seg.text.trim());

    const shouldBreak =
      !next ||
      cur.chars >= opts.maxChars ||
      (cur.chars >= opts.targetChars && (atSentenceEnd || gap >= opts.pauseSeconds));

    if (shouldBreak) {
      drafts.push(cur);
      cur = null;
    }
  }
  if (cur) drafts.push(cur);

  // Fold a too-short trailing/interior section back into its predecessor.
  const merged: Draft[] = [];
  for (const d of drafts) {
    const prev = merged[merged.length - 1];
    if (prev && d.chars < opts.minChars) {
      prev.parts.push(...d.parts);
      prev.chars += d.chars;
      prev.end = d.end;
      continue;
    }
    merged.push(d);
  }

  return merged.map((d, index) => ({
    index,
    startSeconds: d.start,
    endSeconds: d.end,
    text: d.parts.join(" ").replace(/\s+/g, " ").trim(),
    timestamp: formatTimestamp(d.start),
    deepLink: buildDeepLink(videoId, d.start),
    heading: "",
  }));
}

export interface RenderOptions {
  videoId: string;
  title: string;
  /** Video language as spoken, e.g. `hi`, `en`. */
  language: string;
  /** Caption track actually used, e.g. `hi-orig`. */
  captionTrack: string;
  /** True when the captions were machine-generated (ASR). */
  machineGenerated: boolean;
  /** True when the captions were machine-*translated* from another language. */
  machineTranslated?: boolean;
  sections: TranscriptSection[];
  /** Free-text note about transcription quality, shown in the document. */
  qualityNote?: string;
}

/**
 * Render sections as a KB markdown body (no frontmatter — callers add it).
 *
 * Every section heading carries its timestamp, and the first line of every
 * section body carries the `?t=` deep link, so a retrieved chunk always
 * contains enough to locate the claim in the source recording.
 */
export function renderSectionsMarkdown(opts: RenderOptions): string {
  const lines: string[] = [];
  lines.push(`# ${opts.title}`);
  lines.push("");
  lines.push(
    `> **Machine-generated transcript — not a verified source.** Captions for this video were produced by ` +
      `automatic speech recognition (${opts.captionTrack}) and have not been corrected by a clinician. ` +
      `Names, drug names, dosages and numbers are the errors ASR makes most often. ` +
      `Treat every statement below as *what the transcript says*, not as verified medical fact.`,
  );
  lines.push("");
  lines.push(`- **Source video:** [${opts.title}](https://www.youtube.com/watch?v=${opts.videoId})`);
  lines.push(`- **Spoken language:** ${opts.language}`);
  lines.push(
    `- **Captions:** ${opts.machineGenerated ? "auto-generated (ASR)" : "human-authored"}` +
      `${opts.machineTranslated ? ", machine-translated" : ""} — track \`${opts.captionTrack}\``,
  );
  if (opts.qualityNote) lines.push(`- **Transcription quality:** ${opts.qualityNote}`);
  lines.push("");

  for (const s of opts.sections) {
    const heading = s.heading ? `${s.timestamp} — ${s.heading}` : s.timestamp;
    lines.push(`## ${heading}`);
    lines.push("");
    lines.push(`*[Watch from ${s.timestamp}](${s.deepLink})*`);
    lines.push("");
    lines.push(s.text);
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
