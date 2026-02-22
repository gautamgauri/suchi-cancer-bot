import { BadRequestException, GatewayTimeoutException } from "@nestjs/common";
import { VoiceResponse } from "./dto";

// Mock the entire transitive chain that reaches @prisma/client so we don't
// need `prisma generate` to run these pure-logic controller tests.
jest.mock("@prisma/client", () => ({ PrismaClient: class {} }));
jest.mock("./voice.service", () => ({ VoiceService: class {} }));

// Import controller AFTER the mocks are in place
import { VoiceController } from "./voice.controller";

interface MockVoiceService {
  handleVoiceRequest: jest.Mock;
}

describe("VoiceController", () => {
  let controller: VoiceController;
  let mockVoiceService: MockVoiceService;

  const fakeResponse: VoiceResponse = {
    sessionId: "sess-1",
    messageId: "msg-1",
    transcript: "hello",
    confidence: 0.95,
    responseText: "Hi there.",
    voiceResponseText: "Hi there.",
    audioUrl: "https://storage.example.com/audio.mp3",
    safety: { classification: "normal", actions: [] },
    latency: { sttMs: 100, chatMs: 200, ttsMs: 150, totalMs: 450 },
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockVoiceService = {
      handleVoiceRequest: jest.fn().mockResolvedValue(fakeResponse),
    };
    controller = new VoiceController(mockVoiceService as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /* ───────── Missing file ───────── */

  describe("missing audio file", () => {
    test("throws BadRequestException when file is undefined", async () => {
      await expect(
        controller.respond(undefined as any, { sessionId: "sess-1" }),
      ).rejects.toThrow(BadRequestException);
    });

    test("throws BadRequestException when file is null", async () => {
      await expect(
        controller.respond(null as any, { sessionId: "sess-1" }),
      ).rejects.toThrow(BadRequestException);
    });

    test("error message mentions field name", async () => {
      await expect(
        controller.respond(undefined as any, { sessionId: "sess-1" }),
      ).rejects.toThrow("audio");
    });
  });

  /* ───────── MIME type validation ───────── */

  describe("MIME type validation", () => {
    const allowedTypes = [
      "audio/webm",
      "audio/ogg",
      "audio/opus",
      "audio/wav",
      "audio/wave",
      "audio/x-wav",
      "audio/mpeg",
      "audio/mp4",
    ];

    test.each(allowedTypes)("accepts %s", async (mime) => {
      const file = { buffer: Buffer.from("fake"), mimetype: mime } as Express.Multer.File;
      const result = await controller.respond(file, { sessionId: "sess-1" });
      expect(result).toEqual(fakeResponse);
    });

    const rejectedTypes = [
      "audio/flac",
      "video/mp4",
      "application/octet-stream",
      "text/plain",
      "image/png",
    ];

    test.each(rejectedTypes)("rejects %s", async (mime) => {
      const file = { buffer: Buffer.from("fake"), mimetype: mime } as Express.Multer.File;
      await expect(
        controller.respond(file, { sessionId: "sess-1" }),
      ).rejects.toThrow(BadRequestException);
    });

    test("rejected MIME error message includes the unsupported type", async () => {
      const file = { buffer: Buffer.from("fake"), mimetype: "audio/flac" } as Express.Multer.File;
      await expect(
        controller.respond(file, { sessionId: "sess-1" }),
      ).rejects.toThrow("audio/flac");
    });
  });

  /* ───────── Successful delegation ───────── */

  describe("successful request", () => {
    test("passes buffer, mimetype, and dto to VoiceService", async () => {
      const buf = Buffer.from("audio-data");
      const file = { buffer: buf, mimetype: "audio/wav" } as Express.Multer.File;
      const dto = { sessionId: "sess-1", locale: "en-IN" };

      await controller.respond(file, dto);

      expect(mockVoiceService.handleVoiceRequest).toHaveBeenCalledWith(
        buf,
        "audio/wav",
        dto,
      );
    });

    test("returns the VoiceService response as-is", async () => {
      const file = { buffer: Buffer.from("data"), mimetype: "audio/webm" } as Express.Multer.File;
      const result = await controller.respond(file, { sessionId: "sess-1" });
      expect(result).toBe(fakeResponse);
    });
  });

  /* ───────── Timeout handling ───────── */

  describe("timeout handling", () => {
    test("throws GatewayTimeoutException when service takes too long", async () => {
      mockVoiceService.handleVoiceRequest.mockImplementation(
        () => new Promise(() => {}),
      );

      const file = { buffer: Buffer.from("data"), mimetype: "audio/wav" } as Express.Multer.File;
      const promise = controller.respond(file, { sessionId: "sess-1" });

      // Advance past the 45s timeout
      jest.advanceTimersByTime(46_000);

      await expect(promise).rejects.toThrow(GatewayTimeoutException);
    });

    test("timeout error has a user-friendly message", async () => {
      mockVoiceService.handleVoiceRequest.mockImplementation(
        () => new Promise(() => {}),
      );

      const file = { buffer: Buffer.from("data"), mimetype: "audio/wav" } as Express.Multer.File;
      const promise = controller.respond(file, { sessionId: "sess-1" });

      jest.advanceTimersByTime(46_000);

      await expect(promise).rejects.toThrow("timed out");
    });
  });

  /* ───────── Error propagation ───────── */

  describe("error propagation", () => {
    test("re-throws non-timeout errors from VoiceService", async () => {
      mockVoiceService.handleVoiceRequest.mockRejectedValue(
        new Error("STT_PROVIDER_UNAVAILABLE"),
      );

      const file = { buffer: Buffer.from("data"), mimetype: "audio/wav" } as Express.Multer.File;

      await expect(
        controller.respond(file, { sessionId: "sess-1" }),
      ).rejects.toThrow("STT_PROVIDER_UNAVAILABLE");
    });

    test("re-throws BadRequestException from VoiceService", async () => {
      mockVoiceService.handleVoiceRequest.mockRejectedValue(
        new BadRequestException("Audio too long"),
      );

      const file = { buffer: Buffer.from("data"), mimetype: "audio/wav" } as Express.Multer.File;

      await expect(
        controller.respond(file, { sessionId: "sess-1" }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
