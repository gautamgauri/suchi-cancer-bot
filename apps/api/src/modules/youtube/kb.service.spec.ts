jest.mock("puppeteer", () => ({ __esModule: true, default: { launch: jest.fn() } }));

import { Logger } from "@nestjs/common";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { KbService, STAGED_MANIFEST_FILENAME } from "./kb.service";
import { MIN_TRANSCRIPT_CHARS, VideoTranscript } from "./youtube.service";

function makeTranscript(overrides: Partial<VideoTranscript> = {}): VideoTranscript {
  const segments = Array.from({ length: 40 }, (_, i) => ({
    text: `This is sentence number ${i} about breast cancer screening and treatment.`,
    start: i * 5,
    duration: 5,
  }));
  return {
    videoId: "abc12345678",
    title: "Breast Cancer Awareness",
    text: segments.map((s) => s.text).join(" "),
    segments,
    language: "hi",
    captionTrack: "hi-orig",
    machineGenerated: true,
    machineTranslated: false,
    ...overrides,
  };
}

describe("KbService", () => {
  let service: KbService;
  let kbRoot: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    kbRoot = mkdtempSync(join(tmpdir(), "kb-test-"));
    writeFileSync(
      join(kbRoot, "manifest.json"),
      JSON.stringify({ locale: "en", schemaVersion: "2.0", docs: [] }, null, 2),
    );
    process.env.KB_ROOT = kbRoot;
    delete process.env.KB_MANIFEST;
    service = new KbService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(kbRoot, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  describe("resolveKbRoot (issue #91b)", () => {
    it("accepts a directory that is a real KB checkout", () => {
      expect(service.resolveKbRoot()).toBe(kbRoot);
      expect(service.isKbRootWritable()).toBe(true);
    });

    it("REGRESSION #91b: refuses a directory with no manifest.json (Cloud Run scratch)", () => {
      const scratch = mkdtempSync(join(tmpdir(), "scratch-"));
      mkdirSync(join(scratch, "kb"));
      process.env.KB_ROOT = join(scratch, "kb");
      expect(() => service.resolveKbRoot()).toThrow(/not a KB checkout|ephemeral/i);
      expect(service.isKbRootWritable()).toBe(false);
      rmSync(scratch, { recursive: true, force: true });
    });

    it("refuses a path that does not exist at all", () => {
      process.env.KB_ROOT = join(tmpdir(), "definitely-not-here-", String(Date.now()));
      expect(() => service.resolveKbRoot()).toThrow(/does not exist/);
    });
  });

  describe("convertTranscriptToKb", () => {
    it("marks the document inactive and pending review, so RAG cannot retrieve it", async () => {
      const md = await service.convertTranscriptToKb(makeTranscript());
      expect(md).toContain('status: "inactive"');
      expect(md).toContain('reviewStatus: "pending"');
    });

    it("structures the transcript with headings instead of one wall of text", async () => {
      const md = await service.convertTranscriptToKb(makeTranscript());
      expect((md.match(/^## /gm) ?? []).length).toBeGreaterThan(1);
    });

    it("records the caption track and warns the transcript is unverified", async () => {
      const md = await service.convertTranscriptToKb(makeTranscript());
      expect(md).toContain('caption_track: "hi-orig"');
      expect(md).toContain("Machine-generated transcript");
    });

    it("puts a ?t= deep link in the body so a chunk can be traced to a moment", async () => {
      const md = await service.convertTranscriptToKb(makeTranscript());
      expect(md).toMatch(/https:\/\/www\.youtube\.com\/watch\?v=abc12345678&t=\d+s/);
    });
  });

  describe("transcript guards (issue #91a)", () => {
    it("REGRESSION: refuses a transcript with no segments", async () => {
      await expect(
        service.saveToKb(makeTranscript({ segments: [], text: "" })),
      ).rejects.toThrow(/no segments/);
    });

    it("REGRESSION: refuses a transcript below the minimum length", async () => {
      await expect(
        service.saveToKb(
          makeTranscript({ text: "short", segments: [{ text: "short", start: 0, duration: 1 }] }),
        ),
      ).rejects.toThrow(new RegExp(String(MIN_TRANSCRIPT_CHARS)));
    });

    it("refuses a machine-TRANSLATED caption track", async () => {
      await expect(
        service.saveToKb(makeTranscript({ machineTranslated: true, captionTrack: "en" })),
      ).rejects.toThrow(/machine TRANSLATION/);
    });

    it("writes no file and no manifest entry when a transcript is rejected", async () => {
      const before = readFileSync(join(kbRoot, "manifest.json"), "utf-8");
      const result = await service.batchSaveToKb([makeTranscript({ segments: [], text: "" })]);
      expect(result.saved).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.skippedReasons[0].reason).toMatch(/no segments/);
      expect(readFileSync(join(kbRoot, "manifest.json"), "utf-8")).toBe(before);
      expect(existsSync(join(kbRoot, STAGED_MANIFEST_FILENAME))).toBe(false);
      expect(existsSync(join(kbRoot, "hi", "01_suchi_oncotalks"))).toBe(false);
    });
  });

  describe("saveToKb", () => {
    it("writes into the language folder and returns a manifest entry that matches", async () => {
      const { path, manifestEntry } = await service.saveToKb(makeTranscript());
      expect(path).toContain(join("hi", "01_suchi_oncotalks"));
      expect(existsSync(path)).toBe(true);
      expect(manifestEntry.path).toBe(
        `hi/01_suchi_oncotalks/breast-cancer-awareness-abc12345678.md`,
      );
      expect(existsSync(join(kbRoot, manifestEntry.path))).toBe(true);
      expect(manifestEntry.status).toBe("inactive");
      expect(manifestEntry.reviewStatus).toBe("pending");
      expect(manifestEntry.license).toBe("sccf_owned");
      expect(manifestEntry.url).toBe("https://www.youtube.com/watch?v=abc12345678");
    });
  });

  describe("updateManifest", () => {
    /** The live manifest — the only one `npm run kb:ingest` reads. */
    const live = (root: string) => join(root, "manifest.json");

    it("REGRESSION #91: defaults to the staging manifest, never kb/manifest.json", async () => {
      const { manifestEntry } = await service.saveToKb(makeTranscript());
      await service.updateManifest([manifestEntry]);

      const staged = join(kbRoot, STAGED_MANIFEST_FILENAME);
      expect(existsSync(staged)).toBe(true);
      expect(JSON.parse(readFileSync(staged, "utf-8")).docs).toHaveLength(1);
      // `npm run kb:ingest` reads this one, and it must be untouched.
      expect(JSON.parse(readFileSync(live(kbRoot), "utf-8")).docs).toHaveLength(0);
    });

    it("marks a freshly created staging manifest as staged", async () => {
      const { manifestEntry } = await service.saveToKb(makeTranscript());
      await service.updateManifest([manifestEntry]);
      const staged = JSON.parse(readFileSync(join(kbRoot, STAGED_MANIFEST_FILENAME), "utf-8"));
      expect(staged.staged).toBe(true);
      expect(staged.note).toMatch(/NOT INGESTED/);
    });

    it("appends without dropping locale/schemaVersion or existing docs", async () => {
      writeFileSync(
        join(kbRoot, "manifest.json"),
        JSON.stringify({ locale: "en", schemaVersion: "2.0", docs: [{ id: "existing" }] }, null, 2),
      );
      const { manifestEntry } = await service.saveToKb(makeTranscript());
      await service.updateManifest([manifestEntry], live(kbRoot));

      const manifest = JSON.parse(readFileSync(live(kbRoot), "utf-8"));
      expect(manifest.locale).toBe("en");
      expect(manifest.schemaVersion).toBe("2.0");
      expect(manifest.docs.map((d: any) => d.id)).toEqual(["existing", manifestEntry.id]);
    });

    it("is idempotent — re-adding the same id is a no-op", async () => {
      const { manifestEntry } = await service.saveToKb(makeTranscript());
      await service.updateManifest([manifestEntry], live(kbRoot));
      await service.updateManifest([manifestEntry], live(kbRoot));
      const manifest = JSON.parse(readFileSync(live(kbRoot), "utf-8"));
      expect(manifest.docs).toHaveLength(1);
    });

    it("can target a staging manifest so kb:ingest cannot pick the entries up", async () => {
      const staged = join(kbRoot, "manifest.oncotalks-pending.json");
      const { manifestEntry } = await service.saveToKb(makeTranscript());
      await service.updateManifest([manifestEntry], staged);

      expect(JSON.parse(readFileSync(staged, "utf-8")).docs).toHaveLength(1);
      // The manifest that `npm run kb:ingest` actually reads is untouched.
      expect(JSON.parse(readFileSync(join(kbRoot, "manifest.json"), "utf-8")).docs).toHaveLength(0);
    });

    it("leaves no .tmp file behind", async () => {
      const { manifestEntry } = await service.saveToKb(makeTranscript());
      await service.updateManifest([manifestEntry], live(kbRoot));
      expect(existsSync(join(kbRoot, "manifest.json.tmp"))).toBe(false);
    });
  });
});
