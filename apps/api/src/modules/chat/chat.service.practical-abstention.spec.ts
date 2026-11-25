import { ChatService } from "./chat.service";
import { ResponseValidatorService } from "./response-validator.service";
import { AbstentionService } from "../abstention/abstention.service";

/**
 * Issue #260, assessment cause 5. When the pipeline would refuse because a
 * draft names something its evidence does not support, a practical question
 * with no medical content gets the plain practical reply. Every other message
 * keeps the medical abstention wording exactly.
 */
describe("ChatService refusals: practical questions are not sent to a clinician (#260)", () => {
  const svc: any = Object.create(ChatService.prototype);
  svc.responseValidator = new ResponseValidatorService();
  svc.abstention = new AbstentionService();

  it("answers a funding question with the practical reply", () => {
    const reply = svc.ungroundedAbstentionReply(
      "How to apply to the Prime Minister's relief fund for my mother's cancer treatment?",
      false,
    );
    expect(reply.startsWith("Suchi does not have confirmed information on that yet.")).toBe(true);
    expect(reply).not.toMatch(/NCI|clinician/);
    expect(reply).toContain("14555");
  });

  it("keeps the medical abstention wording, word for word, for a medical question", () => {
    const validator = new ResponseValidatorService();
    for (const [text, redFlags] of [
      ["Is tamoxifen safe with my other medicines?", false],
      ["Does Ayushman cover chemotherapy? I am bleeding a lot", true],
    ] as Array<[string, boolean]>) {
      expect(svc.ungroundedAbstentionReply(text, redFlags)).toBe(validator.generateAbstentionResponse(redFlags));
    }
  });

  it("keeps the medical wording for EMERGENCY and PSYCHOSOCIAL categories (review of PR #267)", () => {
    const validator = new ResponseValidatorService();
    const q = "How to apply to the Prime Minister's relief fund for my mother's cancer treatment?";
    for (const category of ["EMERGENCY", "PSYCHOSOCIAL"]) {
      expect(svc.ungroundedAbstentionReply(q, false, category)).toBe(validator.generateAbstentionResponse(false));
    }
    expect(svc.ungroundedAbstentionReply(q, false, "SCHEMES")).toMatch(/^Suchi does not have confirmed information/);
  });

  it("falls back to the existing wording when the verified file cannot be read", () => {
    const fs = require("node:fs");
    const original = fs.readFileSync;
    jest.resetModules();
    const spy = jest.spyOn(fs, "readFileSync").mockImplementation((...args: any[]) => {
      if (String(args[0]).endsWith("financial-support.json")) throw new Error("missing");
      return original.apply(fs, args);
    });
    // A fresh copy of the module graph, so the cached file is not used.
    const { ChatService: Fresh } = require("./chat.service");
    const { ResponseValidatorService: FreshValidator } = require("./response-validator.service");
    const fresh: any = Object.create(Fresh.prototype);
    fresh.responseValidator = new FreshValidator();
    fresh.logger = { error: jest.fn() };
    const q = "How to apply to the Prime Minister's relief fund for my mother's cancer treatment?";
    expect(fresh.ungroundedAbstentionReply(q, false, "SCHEMES")).toBe(fresh.responseValidator.generateAbstentionResponse(false));
    expect(fresh.logger.error).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("applies the same split to the evidence gate's fallback", () => {
    const abstention = new AbstentionService();
    expect(
      svc.evidenceGateFallbackReply(
        "Does health insurance cover cancer?",
        "NO_RESULTS",
        "general",
      ),
    ).toMatch(/^Suchi does not have confirmed information on that yet\./);
    expect(svc.evidenceGateFallbackReply("What does grade 3 mean on a biopsy report?", "NO_RESULTS", "general")).toBe(
      abstention.generateSafeFallbackResponse("NO_RESULTS", "general"),
    );
  });
});
