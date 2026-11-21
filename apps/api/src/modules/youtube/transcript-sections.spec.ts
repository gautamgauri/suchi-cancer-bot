import {
  buildSections,
  decodeHtmlEntities,
  buildDeepLink,
  cleanSegmentText,
  dedupeSegments,
  formatTimestamp,
  renderSectionsMarkdown,
  stripFillers,
  TranscriptSegment,
} from "./transcript-sections";

/**
 * The chunker in src/scripts/ingest-kb.ts. Reproduced verbatim so these tests
 * assert against the behaviour transcripts will actually meet at ingest time.
 * If ingest-kb.ts:130 changes, this copy should change with it.
 */
function chunkMarkdown(md: string, maxChars: number, overlapChars: number): string[] {
  const normalized = md.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const parts = normalized.split(/\n(?=#{1,6}\s)/g);
  const chunks: string[] = [];
  let buf = "";
  const push = () => { const t = buf.trim(); if (t) chunks.push(t); buf = ""; };
  for (const part of parts) {
    if ((buf + "\n\n" + part).length <= maxChars) buf = buf ? buf + "\n\n" + part : part;
    else {
      push();
      if (part.length <= maxChars) buf = part;
      else {
        let i = 0;
        while (i < part.length) {
          chunks.push(part.slice(i, i + maxChars).trim());
          i += Math.max(1, maxChars - overlapChars);
        }
      }
    }
  }
  push();
  return chunks;
}

function makeSegments(count: number, opts: { sentenceEvery?: number } = {}): TranscriptSegment[] {
  const sentenceEvery = opts.sentenceEvery ?? 5;
  const segs: TranscriptSegment[] = [];
  for (let i = 0; i < count; i++) {
    const end = (i + 1) % sentenceEvery === 0 ? "." : "";
    segs.push({ text: `segment number ${i} of the transcript body text${end}`, start: i * 4, duration: 4 });
  }
  return segs;
}

describe("cleanSegmentText", () => {
  it("removes non-speech cues in Latin and Devanagari", () => {
    expect(cleanSegmentText("[Music] hello [Applause] world")).toBe("hello world");
    expect(cleanSegmentText("[संगीत] [प्रशंसा] नमस्कार")).toBe("नमस्कार");
  });

  it("removes YouTube speaker arrows", () => {
    expect(cleanSegmentText(">> So that was in my internship. >> Mhm.")).toBe("So that was in my internship. Mhm.");
  });

  it("decodes HTML-escaped speaker arrows from VTT cues", () => {
    expect(cleanSegmentText("&amp;gt;&amp;gt; hello &gt;&gt; world")).toBe("hello world");
    expect(decodeHtmlEntities("a &amp; b")).toBe("a & b");
  });

  it("collapses whitespace", () => {
    expect(cleanSegmentText("a   b\n c")).toBe("a b c");
  });
});

describe("stripFillers", () => {
  it("removes fillers without eating real words", () => {
    expect(stripFillers("we have, uh, an expert")).toBe("we have, an expert");
    expect(stripFillers("you know, umbrella")).toBe(", umbrella");
    // "um" inside a word must survive
    expect(stripFillers("the tumour is umbilical")).toBe("the tumour is umbilical");
  });
});

describe("dedupeSegments", () => {
  it("collapses YouTube's rolling duplicate captions", () => {
    const out = dedupeSegments([
      { text: "the patient should", start: 0, duration: 2 },
      { text: "the patient should have a mammogram", start: 1, duration: 2 },
      { text: "the patient should have a mammogram", start: 2, duration: 2 },
      { text: "every two years", start: 4, duration: 2 },
    ]);
    expect(out.map((s) => s.text)).toEqual(["the patient should have a mammogram", "every two years"]);
  });

  it("drops segments that are only non-speech cues", () => {
    const out = dedupeSegments([
      { text: "[Music]", start: 0, duration: 3 },
      { text: "hello", start: 3, duration: 1 },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("formatTimestamp / buildDeepLink", () => {
  it("formats mm:ss and h:mm:ss", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(72)).toBe("01:12");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("builds a whole-second ?t= deep link", () => {
    expect(buildDeepLink("abc123", 192.7)).toBe("https://www.youtube.com/watch?v=abc123&t=192s");
  });
});

describe("buildSections", () => {
  it("returns nothing for an empty transcript", () => {
    expect(buildSections([], "vid")).toEqual([]);
  });

  it("keeps sections within the character ceiling", () => {
    const sections = buildSections(makeSegments(200), "vid", { targetChars: 900, maxChars: 1200 });
    expect(sections.length).toBeGreaterThan(1);
    for (const s of sections) expect(s.text.length).toBeLessThanOrEqual(1200);
  });

  it("prefers to break at a sentence end once past the target size", () => {
    const sections = buildSections(makeSegments(200, { sentenceEvery: 4 }), "vid", {
      targetChars: 400,
      maxChars: 1200,
    });
    const nonFinal = sections.slice(0, -1);
    expect(nonFinal.length).toBeGreaterThan(2);
    for (const s of nonFinal) expect(s.text.trim().endsWith(".")).toBe(true);
  });

  it("breaks at a long pause once past the target size", () => {
    const segs: TranscriptSegment[] = [
      { text: "a".repeat(300), start: 0, duration: 5 },
      { text: "b".repeat(200), start: 5, duration: 5 },
      // 30s of silence
      { text: "c".repeat(300), start: 40, duration: 5 },
    ];
    const sections = buildSections(segs, "vid", { targetChars: 400, maxChars: 5000, pauseSeconds: 1 });
    expect(sections).toHaveLength(2);
    expect(sections[0].endSeconds).toBe(10);
    expect(sections[1].startSeconds).toBe(40);
  });

  it("carries the start timestamp and a deep link on every section", () => {
    const sections = buildSections(makeSegments(120), "dQw4w9WgXcQ", { targetChars: 300, maxChars: 500 });
    for (const s of sections) {
      expect(s.deepLink).toBe(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=${Math.floor(s.startSeconds)}s`);
      expect(s.timestamp).toBe(formatTimestamp(s.startSeconds));
    }
  });

  it("merges a runt trailing section into its predecessor", () => {
    const segs: TranscriptSegment[] = [
      { text: "x".repeat(900) + ".", start: 0, duration: 5 },
      { text: "tiny tail.", start: 5, duration: 1 },
    ];
    const sections = buildSections(segs, "vid", { targetChars: 800, maxChars: 1000, minChars: 200 });
    expect(sections).toHaveLength(1);
    expect(sections[0].text).toContain("tiny tail.");
  });
});

describe("renderSectionsMarkdown", () => {
  const sections = buildSections(makeSegments(150), "vid123", { targetChars: 700, maxChars: 900 });
  const md = renderSectionsMarkdown({
    videoId: "vid123",
    title: "Onco Talks Episode 6",
    language: "en",
    captionTrack: "en-orig",
    machineGenerated: true,
    sections,
  });

  it("warns that the transcript is machine-generated and unverified", () => {
    expect(md).toContain("Machine-generated transcript — not a verified source.");
  });

  it("gives every section a heading, so the chunker never falls back to a blind cut", () => {
    const headings = md.match(/^## /gm) ?? [];
    expect(headings).toHaveLength(sections.length);
  });

  it("puts a resolvable ?t= deep link inside every section body", () => {
    for (const s of sections) expect(md).toContain(s.deepLink);
  });

  describe("as consumed by ingest-kb.ts chunkMarkdown", () => {
    // Defaults from src/scripts/ingest-kb.ts parseArgs().
    const chunks = chunkMarkdown(md, 1400, 200);

    it("produces chunks that each begin at a heading", () => {
      // Chunk 0 is the document preamble; every later chunk must start at a
      // heading rather than mid-sentence.
      for (const chunk of chunks.slice(1)) expect(chunk.startsWith("#")).toBe(true);
    });

    it("gives every chunk a locatable source link", () => {
      for (const chunk of chunks.slice(1)) {
        expect(chunk).toMatch(/https:\/\/www\.youtube\.com\/watch\?v=vid123&t=\d+s/);
      }
    });

    it("never splits a section blind, unlike an unstructured transcript", () => {
      const flat = sections.map((s) => s.text).join(" ");
      const flatChunks = chunkMarkdown(flat, 1400, 200);
      // The unstructured control: more than one chunk, and the boundaries are
      // arbitrary — the second chunk starts mid-word/mid-sentence.
      expect(flatChunks.length).toBeGreaterThan(1);
      expect(flatChunks[1].startsWith("#")).toBe(false);
    });
  });
});
