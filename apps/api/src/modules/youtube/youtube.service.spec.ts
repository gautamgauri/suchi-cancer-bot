const mockFetchTranscript = jest.fn();

jest.mock("youtube-transcript", () => ({
  YoutubeTranscript: { fetchTranscript: (...args: any[]) => mockFetchTranscript(...args) },
}));
// Puppeteer is only reached as a last resort and is expensive to load.
jest.mock("puppeteer", () => ({ __esModule: true, default: { launch: jest.fn() } }));

import { Logger } from "@nestjs/common";
import {
  YoutubeService,
  hasSegments,
  transcriptTextLength,
  MIN_TRANSCRIPT_CHARS,
  VideoTranscript,
} from "./youtube.service";

const longText = "a".repeat(MIN_TRANSCRIPT_CHARS + 50);

function apiSegments(count: number, chars = 120) {
  return Array.from({ length: count }, (_, i) => ({
    text: "x".repeat(chars),
    offset: i * 4000,
    duration: 4000,
  }));
}

function ytDlpResult(overrides: Partial<VideoTranscript> = {}): VideoTranscript {
  return {
    videoId: "vid",
    title: "From yt-dlp",
    text: longText,
    segments: [{ text: longText, start: 0, duration: 5 }],
    language: "hi",
    captionTrack: "hi-orig",
    machineGenerated: true,
    machineTranslated: false,
    ...overrides,
  };
}

describe("YoutubeService", () => {
  let service: YoutubeService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    service = new YoutubeService();
  });

  afterEach(() => jest.restoreAllMocks());

  describe("hasSegments (issue #91a)", () => {
    it("treats an empty array as no transcript, because [] is truthy", () => {
      expect(hasSegments([])).toBe(false);
      // The reason the old `if (!transcriptData)` guard never fired:
      const empty: unknown = [];
      expect(Boolean(empty)).toBe(true);
      expect(hasSegments([{ text: "a" }])).toBe(true);
      expect(hasSegments(undefined)).toBe(false);
      expect(hasSegments(null)).toBe(false);
    });
  });

  describe("transcriptTextLength", () => {
    it("sums segment text lengths and tolerates missing text", () => {
      expect(transcriptTextLength([{ text: "abc" }, {}, { text: "de" }])).toBe(5);
    });
  });

  describe("getVideoTranscript", () => {
    it("REGRESSION #91a: falls through to yt-dlp when the API resolves with an empty array", async () => {
      // youtube-transcript@1.2.1 does not throw for a video without captions.
      mockFetchTranscript.mockResolvedValue([]);
      const ytDlp = jest
        .spyOn(service as any, "getTranscriptWithYtDlp")
        .mockResolvedValue(ytDlpResult());

      const result = await service.getVideoTranscript("vid");

      expect(ytDlp).toHaveBeenCalledTimes(1);
      expect(result.title).toBe("From yt-dlp");
      expect(result.segments.length).toBeGreaterThan(0);
    });

    it("REGRESSION #91a: never returns a zero-segment transcript to the caller", async () => {
      mockFetchTranscript.mockResolvedValue([]);
      jest
        .spyOn(service as any, "getTranscriptWithYtDlp")
        .mockRejectedValue(new Error("no captions"));
      jest
        .spyOn(service as any, "getTranscriptWithPuppeteer")
        .mockResolvedValue({ videoId: "vid", title: "t", text: "", segments: [], language: "hi" });

      await expect(service.getVideoTranscript("vid")).rejects.toThrow(/no segments|refusing/i);
    });

    it("falls through when the API returns segments that are too short to be usable", async () => {
      mockFetchTranscript.mockResolvedValue([{ text: "hello", offset: 0, duration: 1000 }]);
      const ytDlp = jest
        .spyOn(service as any, "getTranscriptWithYtDlp")
        .mockResolvedValue(ytDlpResult());

      await service.getVideoTranscript("vid");
      expect(ytDlp).toHaveBeenCalled();
    });

    it("uses the API result when it is genuinely usable, converting ms offsets to seconds", async () => {
      mockFetchTranscript.mockResolvedValue(apiSegments(10));
      const ytDlp = jest.spyOn(service as any, "getTranscriptWithYtDlp");

      const result = await service.getVideoTranscript("vid", "en");

      expect(ytDlp).not.toHaveBeenCalled();
      expect(result.segments[1].start).toBe(4);
      expect(result.segments[1].duration).toBe(4);
      expect(result.machineGenerated).toBe(true);
    });

    it("tries Puppeteer only after yt-dlp fails", async () => {
      mockFetchTranscript.mockResolvedValue([]);
      jest.spyOn(service as any, "getTranscriptWithYtDlp").mockRejectedValue(new Error("boom"));
      const puppeteer = jest
        .spyOn(service as any, "getTranscriptWithPuppeteer")
        .mockResolvedValue(ytDlpResult({ title: "From puppeteer" }));

      const result = await service.getVideoTranscript("vid");

      expect(puppeteer).toHaveBeenCalledTimes(1);
      expect(result.title).toBe("From puppeteer");
    });
  });

  describe("assertUsable", () => {
    it("rejects an empty transcript", () => {
      expect(() =>
        service.assertUsable({ videoId: "v", title: "t", text: "", segments: [], language: "en" }),
      ).toThrow(/no segments/);
    });

    it("rejects a transcript below the minimum length", () => {
      expect(() =>
        service.assertUsable({
          videoId: "v",
          title: "t",
          text: "too short",
          segments: [{ text: "too short", start: 0, duration: 1 }],
          language: "en",
        }),
      ).toThrow(new RegExp(String(MIN_TRANSCRIPT_CHARS)));
    });

    it("accepts a usable transcript", () => {
      expect(() => service.assertUsable(ytDlpResult())).not.toThrow();
    });
  });

  describe("resolveCaptionTrack", () => {
    it("prefers a human-authored track above everything", async () => {
      jest.spyOn(service, "getVideoMetadata").mockResolvedValue({
        subtitles: { en: [{}] },
        automatic_captions: { "hi-orig": [{}], en: [{}] },
      });
      await expect(service.resolveCaptionTrack("vid", "en")).resolves.toEqual({
        track: "en",
        language: "en",
        machineTranslated: false,
      });
    });

    it("picks the ORIGINAL-language ASR track over a machine translation", async () => {
      // YouTube offers auto-translated `en` for any video with ASR. Asking for
      // `en` on a Hindi video used to silently return a translation of a
      // transcription.
      jest.spyOn(service, "getVideoMetadata").mockResolvedValue({
        subtitles: {},
        automatic_captions: { "hi-orig": [{}], en: [{}], fr: [{}], hi: [{}] },
      });
      await expect(service.resolveCaptionTrack("vid", "en")).resolves.toEqual({
        track: "hi-orig",
        language: "hi",
        machineTranslated: false,
      });
    });

    it("flags a machine-translated track when no original track exists", async () => {
      jest.spyOn(service, "getVideoMetadata").mockResolvedValue({
        subtitles: {},
        automatic_captions: { en: [{}], fr: [{}] },
      });
      await expect(service.resolveCaptionTrack("vid", "en")).resolves.toEqual({
        track: "en",
        language: "en",
        machineTranslated: true,
      });
    });

    it("returns null when the video has no captions at all", async () => {
      jest.spyOn(service, "getVideoMetadata").mockResolvedValue({ subtitles: {}, automatic_captions: {} });
      await expect(service.resolveCaptionTrack("vid")).resolves.toBeNull();
    });

    it("returns null when the video is unavailable", async () => {
      jest.spyOn(service, "getVideoMetadata").mockResolvedValue(null);
      await expect(service.resolveCaptionTrack("vid")).resolves.toBeNull();
    });
  });

  describe("parseJson3", () => {
    it("produces one segment per event with second-precision timings", () => {
      const json3 = JSON.stringify({
        events: [
          { tStartMs: 11000, dDurationMs: 4200, segs: [{ utf8: "Good " }, { utf8: "afternoon." }] },
          { tStartMs: 15200, dDurationMs: 3000, segs: [{ utf8: "Welcome." }] },
          { tStartMs: 18000, dDurationMs: 1000 }, // no segs — a formatting event
          { tStartMs: 19000, dDurationMs: 1000, segs: [{ utf8: "\n" }] }, // whitespace only
        ],
      });
      const { segments, text } = new YoutubeService().parseJson3(json3);
      expect(segments).toEqual([
        { text: "Good afternoon.", start: 11, duration: 4.2 },
        { text: "Welcome.", start: 15.2, duration: 3 },
      ]);
      expect(text).toBe("Good afternoon.\nWelcome.");
    });
  });

  describe("extractVideoId", () => {
    it("handles watch URLs, short URLs and bare ids", () => {
      expect(service.extractVideoId("https://www.youtube.com/watch?v=6edsfQY1TZU")).toBe("6edsfQY1TZU");
      expect(service.extractVideoId("https://youtu.be/6edsfQY1TZU")).toBe("6edsfQY1TZU");
      expect(service.extractVideoId("6edsfQY1TZU")).toBe("6edsfQY1TZU");
      expect(service.extractVideoId("not a video")).toBeNull();
    });
  });
});
