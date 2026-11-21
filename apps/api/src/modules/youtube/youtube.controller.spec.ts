// Puppeteer is pulled in transitively by youtube.service and is expensive to load.
jest.mock("puppeteer", () => ({ __esModule: true, default: { launch: jest.fn() } }));

import { ForbiddenException, Logger } from "@nestjs/common";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { YoutubeController } from "./youtube.controller";
import { YoutubeService, VideoTranscript } from "./youtube.service";
import { KbService, STAGED_MANIFEST_FILENAME } from "./kb.service";

function usableTranscript(): VideoTranscript {
  const segments = Array.from({ length: 40 }, (_, i) => ({
    text: `Sentence ${i} about breast cancer screening in Bihar.`,
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
  };
}

describe("YoutubeController (issue #91)", () => {
  let controller: YoutubeController;
  let youtube: YoutubeService;
  let kb: KbService;
  let kbRoot: string;
  const originalEnv = { ...process.env };

  const liveManifest = () => join(kbRoot, "manifest.json");
  const stagedManifest = () => join(kbRoot, STAGED_MANIFEST_FILENAME);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    kbRoot = mkdtempSync(join(tmpdir(), "kb-ctl-"));
    writeFileSync(
      liveManifest(),
      JSON.stringify({ locale: "en", schemaVersion: "2.0", docs: [] }, null, 2),
    );
    process.env.KB_ROOT = kbRoot;
    delete process.env.KB_MANIFEST;
    process.env.YOUTUBE_INGEST_ENABLED = "true";

    youtube = new YoutubeService();
    kb = new KbService();
    controller = new YoutubeController(youtube, kb);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(kbRoot, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  describe("ingest flag gate", () => {
    it("REGRESSION #91: refuses to run when the flag is unset", async () => {
      delete process.env.YOUTUBE_INGEST_ENABLED;
      const save = jest.spyOn(kb, "batchSaveToKb");

      await expect(controller.ingestTranscripts({ videoIds: ["abc12345678"] })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(save).not.toHaveBeenCalled();
      expect(existsSync(stagedManifest())).toBe(false);
    });

    it("refuses any value other than an explicit true", async () => {
      for (const value of ["false", "1", "yes", ""]) {
        process.env.YOUTUBE_INGEST_ENABLED = value;
        await expect(
          controller.ingestTranscripts({ videoIds: ["abc12345678"] }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it("refuses before doing any network work", async () => {
      delete process.env.YOUTUBE_INGEST_ENABLED;
      const fetch = jest.spyOn(youtube, "getVideoTranscript");
      await expect(controller.ingestTranscripts({ videoIds: ["abc12345678"] })).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("empty transcripts (issue #91a)", () => {
    it("REGRESSION: an empty transcript writes no KB file and no manifest entry", async () => {
      // youtube-transcript@1.2.1 resolves with [] rather than throwing; this is
      // the shape that used to reach the manifest as an empty document.
      jest.spyOn(youtube, "getVideoTranscript").mockResolvedValue({
        videoId: "abc12345678",
        title: "Empty",
        text: "",
        segments: [],
        language: "hi",
      } as VideoTranscript);

      const result: any = await controller.ingestTranscripts({ videoIds: ["abc12345678"] });

      expect(result.saved).toBe(0);
      expect(result.skipped[0].reason).toMatch(/no segments/);
      expect(existsSync(stagedManifest())).toBe(false);
      expect(JSON.parse(readFileSync(liveManifest(), "utf-8")).docs).toHaveLength(0);
      expect(existsSync(join(kbRoot, "hi", "01_suchi_oncotalks"))).toBe(false);
    });

    it("REGRESSION: a below-minimum transcript is skipped, not written", async () => {
      jest.spyOn(youtube, "getVideoTranscript").mockResolvedValue({
        videoId: "abc12345678",
        title: "Too short",
        text: "namaste",
        segments: [{ text: "namaste", start: 0, duration: 1 }],
        language: "hi",
      } as VideoTranscript);

      const result: any = await controller.ingestTranscripts({ videoIds: ["abc12345678"] });

      expect(result.saved).toBe(0);
      expect(result.skipped[0].reason).toMatch(/minimum/);
      expect(existsSync(stagedManifest())).toBe(false);
    });
  });

  describe("a usable transcript", () => {
    it("stages the entry and leaves kb/manifest.json alone", async () => {
      jest.spyOn(youtube, "getVideoTranscript").mockResolvedValue(usableTranscript());

      const result: any = await controller.ingestTranscripts({ videoIds: ["abc12345678"] });

      expect(result.saved).toBe(1);
      const staged = JSON.parse(readFileSync(stagedManifest(), "utf-8"));
      expect(staged.docs).toHaveLength(1);
      expect(staged.docs[0].status).toBe("inactive");
      expect(staged.docs[0].reviewStatus).toBe("pending");
      // The manifest `npm run kb:ingest` reads is untouched.
      expect(JSON.parse(readFileSync(liveManifest(), "utf-8")).docs).toHaveLength(0);
    });
  });

  describe("KB root", () => {
    it("REGRESSION #91b: refuses container scratch that is not a KB checkout", async () => {
      const scratch = mkdtempSync(join(tmpdir(), "scratch-"));
      process.env.KB_ROOT = scratch;
      const result: any = await controller.ingestTranscripts({ videoIds: ["abc12345678"] }).catch((e) => e);
      expect(String(result.message ?? result)).toMatch(/writable KB checkout|KB_ROOT/);
      rmSync(scratch, { recursive: true, force: true });
    });
  });
});
