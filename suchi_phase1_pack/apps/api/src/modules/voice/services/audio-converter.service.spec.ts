import { BadRequestException } from "@nestjs/common";
import { AudioConverterService } from "./audio-converter.service";

// Mock child_process and fs so we never touch the real filesystem or ffmpeg
jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));

jest.mock("fs/promises", () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from("fake-wav")),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

import { execFile } from "child_process";
import { readFile } from "fs/promises";

const execFileMock = execFile as unknown as jest.Mock;
const readFileMock = readFile as jest.Mock;

function makeConfigService(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    VOICE_MAX_AUDIO_SIZE_BYTES: 2097152, // 2MB
    VOICE_MAX_AUDIO_DURATION_SEC: 60,
  };
  return {
    get: jest.fn((key: string) => overrides[key] ?? defaults[key]),
  };
}

/** Simulate promisified execFile resolving with stdout */
function mockExecFileSuccess(stdout = "10.5") {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], callback: (...a: any[]) => void) => {
      callback(null, { stdout, stderr: "" });
    },
  );
}

/** Simulate ffprobe returning a specific duration, then ffmpeg succeeding */
function mockProbeAndConvert(durationSec: number) {
  let callCount = 0;
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], callback: (...a: any[]) => void) => {
      callCount++;
      if (callCount === 1) {
        // ffprobe
        callback(null, { stdout: `${durationSec}\n`, stderr: "" });
      } else {
        // ffmpeg
        callback(null, { stdout: "", stderr: "" });
      }
    },
  );
}

describe("AudioConverterService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /* ───────── File size validation ───────── */

  describe("file size validation", () => {
    test("rejects buffer exceeding max size (default 2MB)", async () => {
      const service = new AudioConverterService(makeConfigService() as any);
      const oversized = Buffer.alloc(2097153); // 1 byte over 2MB

      await expect(
        service.convertToLinear16(oversized, "audio/wav"),
      ).rejects.toThrow(BadRequestException);
    });

    test("rejects buffer exceeding custom max size", async () => {
      const service = new AudioConverterService(
        makeConfigService({ VOICE_MAX_AUDIO_SIZE_BYTES: 1000 }) as any,
      );
      const oversized = Buffer.alloc(1001);

      await expect(
        service.convertToLinear16(oversized, "audio/wav"),
      ).rejects.toThrow(BadRequestException);
    });

    test("error message includes actual and max sizes", async () => {
      const service = new AudioConverterService(
        makeConfigService({ VOICE_MAX_AUDIO_SIZE_BYTES: 1000 }) as any,
      );

      await expect(
        service.convertToLinear16(Buffer.alloc(1500), "audio/wav"),
      ).rejects.toThrow(/1500.*1000/);
    });

    test("accepts buffer at exactly max size", async () => {
      const service = new AudioConverterService(
        makeConfigService({ VOICE_MAX_AUDIO_SIZE_BYTES: 1000 }) as any,
      );
      mockProbeAndConvert(5);
      readFileMock.mockResolvedValue(Buffer.from("wav-data"));

      // Should not throw
      const result = await service.convertToLinear16(Buffer.alloc(1000), "audio/wav");
      expect(result.wavBuffer).toBeDefined();
    });
  });

  /* ───────── Duration validation ───────── */

  describe("duration validation", () => {
    test("rejects audio exceeding max duration (default 60s)", async () => {
      const service = new AudioConverterService(makeConfigService() as any);

      // ffprobe returns 61 seconds
      execFileMock.mockImplementation(
        (_cmd: string, _args: string[], callback: (...a: any[]) => void) => {
          callback(null, { stdout: "61.0\n", stderr: "" });
        },
      );

      await expect(
        service.convertToLinear16(Buffer.alloc(100), "audio/wav"),
      ).rejects.toThrow(BadRequestException);
    });

    test("rejects audio exceeding custom max duration", async () => {
      const service = new AudioConverterService(
        makeConfigService({ VOICE_MAX_AUDIO_DURATION_SEC: 10 }) as any,
      );

      execFileMock.mockImplementation(
        (_cmd: string, _args: string[], callback: (...a: any[]) => void) => {
          callback(null, { stdout: "11.0\n", stderr: "" });
        },
      );

      await expect(
        service.convertToLinear16(Buffer.alloc(100), "audio/wav"),
      ).rejects.toThrow(BadRequestException);
    });

    test("error message includes actual and max durations", async () => {
      const service = new AudioConverterService(
        makeConfigService({ VOICE_MAX_AUDIO_DURATION_SEC: 30 }) as any,
      );

      execFileMock.mockImplementation(
        (_cmd: string, _args: string[], callback: (...a: any[]) => void) => {
          callback(null, { stdout: "45.3\n", stderr: "" });
        },
      );

      await expect(
        service.convertToLinear16(Buffer.alloc(100), "audio/wav"),
      ).rejects.toThrow(/45\.3.*30/);
    });

    test("accepts audio at exactly max duration", async () => {
      const service = new AudioConverterService(
        makeConfigService({ VOICE_MAX_AUDIO_DURATION_SEC: 60 }) as any,
      );
      mockProbeAndConvert(60);

      const result = await service.convertToLinear16(Buffer.alloc(100), "audio/wav");
      expect(result.wavBuffer).toBeDefined();
    });
  });

  /* ───────── Successful conversion ───────── */

  describe("successful conversion", () => {
    test("returns wavBuffer and durationMs", async () => {
      const service = new AudioConverterService(makeConfigService() as any);
      mockProbeAndConvert(5.2);
      readFileMock.mockResolvedValue(Buffer.from("converted-wav"));

      const result = await service.convertToLinear16(Buffer.alloc(100), "audio/webm");
      expect(result.wavBuffer).toEqual(Buffer.from("converted-wav"));
      expect(result.durationMs).toBe(5200);
    });

    test("rounds duration to nearest millisecond", async () => {
      const service = new AudioConverterService(makeConfigService() as any);
      mockProbeAndConvert(3.456);

      const result = await service.convertToLinear16(Buffer.alloc(100), "audio/ogg");
      expect(result.durationMs).toBe(3456);
    });

    test("handles zero duration from ffprobe", async () => {
      const service = new AudioConverterService(makeConfigService() as any);
      mockProbeAndConvert(0);

      const result = await service.convertToLinear16(Buffer.alloc(100), "audio/wav");
      expect(result.durationMs).toBe(0);
    });
  });

  /* ───────── Config defaults ───────── */

  describe("configuration defaults", () => {
    test("uses 2MB default when VOICE_MAX_AUDIO_SIZE_BYTES not set", async () => {
      const service = new AudioConverterService(
        makeConfigService({ VOICE_MAX_AUDIO_SIZE_BYTES: undefined }) as any,
      );

      // 2MB + 1 byte should be rejected
      await expect(
        service.convertToLinear16(Buffer.alloc(2097153), "audio/wav"),
      ).rejects.toThrow(BadRequestException);
    });

    test("uses 60s default when VOICE_MAX_AUDIO_DURATION_SEC not set", async () => {
      const service = new AudioConverterService(
        makeConfigService({ VOICE_MAX_AUDIO_DURATION_SEC: undefined }) as any,
      );

      execFileMock.mockImplementation(
        (_cmd: string, _args: string[], callback: (...a: any[]) => void) => {
          callback(null, { stdout: "61\n", stderr: "" });
        },
      );

      await expect(
        service.convertToLinear16(Buffer.alloc(100), "audio/wav"),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
