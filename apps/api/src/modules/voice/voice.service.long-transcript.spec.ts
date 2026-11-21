import { VoiceService } from "./voice.service";
import { MAX_USER_TEXT_HARD_LIMIT, MAX_USER_TEXT_LENGTH } from "../chat/dto";

/**
 * Review B1 of PR #202: the voice path hands ChatService the whole transcript,
 * so the safety screen sees a phrase near the end of a long one. ChatService
 * cuts it to MAX_USER_TEXT_LENGTH only after screening. Synthetic text.
 */
describe("VoiceService passes the whole transcript to the chat pipeline", () => {
  function build() {
    const svc: any = Object.create(VoiceService.prototype);
    svc.chatService = { handle: jest.fn(async () => ({ responseText: "ok", safety: { classification: "normal" } })) };
    svc.condenser = { condense: () => ({ plainText: "ok", ssml: "<speak>ok</speak>" }) };
    svc.tts = { synthesize: jest.fn(async () => { throw new Error("tts off in this spec"); }) };
    svc.gcsStorage = { uploadAndSign: jest.fn() };
    svc.logger = { warn: () => undefined, log: () => undefined, error: () => undefined };
    return svc;
  }

  it("does not cut a transcript longer than the pipeline bound", async () => {
    const svc = build();
    const transcript = "I have some questions about my treatment plan. ".repeat(200) + " I want to kill myself";
    expect(transcript.length).toBeGreaterThan(MAX_USER_TEXT_LENGTH);
    await svc.runPipeline("00000000-0000-4000-8000-00000000000a", transcript, "en-IN").catch(() => undefined);
    expect(svc.chatService.handle).toHaveBeenCalledTimes(1);
    expect(svc.chatService.handle.mock.calls[0][0].userText).toBe(transcript);
  });

  it("cuts only at the abuse ceiling", async () => {
    const svc = build();
    const transcript = "a".repeat(MAX_USER_TEXT_HARD_LIMIT + 10);
    await svc.runPipeline("00000000-0000-4000-8000-00000000000b", transcript, "en-IN").catch(() => undefined);
    expect(svc.chatService.handle.mock.calls[0][0].userText).toHaveLength(MAX_USER_TEXT_HARD_LIMIT);
  });
});
