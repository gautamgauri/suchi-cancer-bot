jest.mock("puppeteer", () => ({ __esModule: true, default: { launch: jest.fn() } }));

import { Logger } from "@nestjs/common";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { YoutubeService, VideoTranscript } from "../modules/youtube/youtube.service";
import {
  main,
  selectVideos,
  mergeStagedManifest,
  emptyStagedManifest,
  CurationFile,
  StagedManifest,
} from "./youtube-transcript-draft";
import { KbDocument } from "../modules/youtube/kb.service";

function makeTranscript(overrides: Partial<VideoTranscript> = {}): VideoTranscript {
  const segments = Array.from({ length: 40 }, (_, i) => ({
    text: `This is sentence number ${i} about breast cancer screening and treatment.`,
    start: i * 5,
    duration: 5,
  }));
  return {
    videoId: "vid00000001",
    title: "Episode",
    text: segments.map((s) => s.text).join(" "),
    segments,
    language: "hi",
    captionTrack: "hi-orig",
    machineGenerated: true,
    machineTranslated: false,
    ...overrides,
  };
}

function doc(id: string, extra: Record<string, unknown> = {}): KbDocument & Record<string, unknown> {
  return {
    id,
    title: id,
    version: "v1",
    status: "inactive",
    source: "s",
    sourceType: "01_suchi_oncotalks",
    path: `hi/01_suchi_oncotalks/${id}.md`,
    license: "sccf_owned",
    lastReviewed: "2026-09-06",
    reviewFrequency: "annual",
    audienceLevel: "patient",
    language: "hi",
    cancerTypes: [],
    tags: [],
    url: "u",
    citation: "c",
    ...extra,
  };
}

const CURATION: CurationFile = {
  channelId: "c",
  channelUrl: "https://youtube.com/c",
  videos: [
    { videoId: "aaa00000001", decision: "include", reason: "in scope", language: "hi", title: "Part One" },
    { videoId: "bbb00000002", decision: "include", reason: "in scope", language: "hi", title: "Part Two" },
    { videoId: "ccc00000003", decision: "exclude", reason: "Sponsored. Not SCCF-owned." },
  ],
};

describe("youtube-transcript-draft helpers", () => {
  describe("selectVideos", () => {
    it("returns every included video when --only is absent", () => {
      expect(selectVideos(CURATION).map((v) => v.videoId)).toEqual(["aaa00000001", "bbb00000002"]);
    });

    it("returns just the named video for --only", () => {
      expect(selectVideos(CURATION, "bbb00000002").map((v) => v.videoId)).toEqual(["bbb00000002"]);
    });

    it("throws on an unknown --only id instead of building nothing", () => {
      expect(() => selectVideos(CURATION, "typo0000000")).toThrow(/no such video in the curation file/);
    });

    it("throws when --only names a video the curation excludes", () => {
      expect(() => selectVideos(CURATION, "ccc00000003")).toThrow(/curated as "exclude"/);
    });
  });

  describe("mergeStagedManifest", () => {
    const existing = (): StagedManifest => ({
      ...emptyStagedManifest(),
      docs: [doc("kb_hi_oncotalks_aaa00000001_v1", { tracked: true }), doc("kb_hi_oncotalks_bbb00000002_v1")],
    });

    it("replaces a single entry by id and keeps the others (--only)", () => {
      const regenerated = doc("kb_hi_oncotalks_bbb00000002_v1", { title: "Part Two (regenerated)" });
      const merged = mergeStagedManifest(existing(), [regenerated], { replaceAll: false });

      expect(merged.docs.map((d) => d.id)).toEqual([
        "kb_hi_oncotalks_aaa00000001_v1",
        "kb_hi_oncotalks_bbb00000002_v1",
      ]);
      expect(merged.docs[1].title).toBe("Part Two (regenerated)");
      expect(merged.docs[0].tracked).toBe(true);
    });

    it("appends an entry that is not in the manifest yet (--only)", () => {
      const merged = mergeStagedManifest(existing(), [doc("kb_en_oncotalks_zzz00000009_v1")], { replaceAll: false });
      expect(merged.docs).toHaveLength(3);
      expect(merged.docs[2].id).toBe("kb_en_oncotalks_zzz00000009_v1");
    });

    it("preserves hand-maintained fields the generator does not produce", () => {
      const merged = mergeStagedManifest(existing(), [doc("kb_hi_oncotalks_aaa00000001_v1")], { replaceAll: false });
      expect(merged.docs[0].tracked).toBe(true);
    });

    it("rewrites the document list on a full run", () => {
      const merged = mergeStagedManifest(existing(), [doc("kb_hi_oncotalks_aaa00000001_v1")], { replaceAll: true });
      expect(merged.docs.map((d) => d.id)).toEqual(["kb_hi_oncotalks_aaa00000001_v1"]);
      expect(merged.docs[0].tracked).toBe(true);
    });

    it("starts from an empty staged manifest when there is no file yet", () => {
      const merged = mergeStagedManifest(null, [doc("kb_hi_oncotalks_aaa00000001_v1")], { replaceAll: false });
      expect(merged.staged).toBe(true);
      expect(merged.docs).toHaveLength(1);
    });
  });
});

describe("youtube-transcript-draft main()", () => {
  let kbRoot: string;
  let curationPath: string;
  let manifestPath: string;
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    kbRoot = mkdtempSync(join(tmpdir(), "kb-draft-"));
    writeFileSync(join(kbRoot, "manifest.json"), JSON.stringify({ locale: "en", schemaVersion: "2.0", docs: [] }));
    mkdirSync(join(kbRoot, "hi", "01_suchi_oncotalks"), { recursive: true });

    curationPath = join(kbRoot, "curation.json");
    writeFileSync(curationPath, JSON.stringify(CURATION));
    manifestPath = join(kbRoot, "manifest.oncotalks-pending.json");

    jest
      .spyOn(YoutubeService.prototype, "getVideoTranscript")
      .mockImplementation(async (videoId: string, lang?: string) =>
        makeTranscript({ videoId, language: lang ?? "hi", captionTrack: `${lang ?? "hi"}-orig`, title: videoId }),
      );

    process.exitCode = undefined;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.argv = originalArgv;
    process.env = { ...originalEnv };
    process.exitCode = undefined;
    rmSync(kbRoot, { recursive: true, force: true });
  });

  const run = async (...extra: string[]) => {
    process.argv = [
      "node",
      "youtube-transcript-draft.ts",
      "--curation",
      curationPath,
      "--kbRoot",
      kbRoot,
      "--manifest",
      manifestPath,
      ...extra,
    ];
    await main();
  };

  const readManifest = (): StagedManifest => JSON.parse(readFileSync(manifestPath, "utf-8"));

  it("writes every included entry on a full run", async () => {
    await run();
    expect(readManifest().docs.map((d) => d.id)).toEqual([
      "kb_hi_oncotalks_aaa00000001_v1",
      "kb_hi_oncotalks_bbb00000002_v1",
    ]);
  });

  it("--only keeps the other entries instead of rewriting the manifest", async () => {
    await run();
    const before = readManifest();
    expect(before.docs).toHaveLength(2);

    await run("--only", "aaa00000001");

    const after = readManifest();
    expect(after.docs.map((d) => d.id)).toEqual([
      "kb_hi_oncotalks_aaa00000001_v1",
      "kb_hi_oncotalks_bbb00000002_v1",
    ]);
  });

  it("--only preserves a hand-added field on the entry it regenerates", async () => {
    await run();
    const staged = readManifest();
    staged.docs[0].tracked = false;
    writeFileSync(manifestPath, JSON.stringify(staged, null, 2));

    await run("--only", "aaa00000001");

    expect(readManifest().docs[0].tracked).toBe(false);
  });

  it("--only with an unknown id throws and leaves the manifest untouched", async () => {
    await run();
    const before = readFileSync(manifestPath, "utf-8");

    await expect(run("--only", "notavideoid")).rejects.toThrow(/no such video in the curation file/);

    expect(readFileSync(manifestPath, "utf-8")).toBe(before);
  });

  it("--only with an unknown id never writes a manifest when none exists", async () => {
    await expect(run("--only", "notavideoid")).rejects.toThrow(/no such video/);
    expect(existsSync(manifestPath)).toBe(false);
  });
});
