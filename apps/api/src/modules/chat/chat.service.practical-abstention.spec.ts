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

  it("applies the same split to the evidence gate's fallback", () => {
    const abstention = new AbstentionService();
    expect(
      svc.evidenceGateFallbackReply(
        "Does health insurance cover cancer if it was diagnosed after I bought the policy?",
        "NO_RESULTS",
        "general",
      ),
    ).toMatch(/^Suchi does not have confirmed information on that yet\./);
    expect(svc.evidenceGateFallbackReply("What does grade 3 mean on a biopsy report?", "NO_RESULTS", "general")).toBe(
      abstention.generateSafeFallbackResponse("NO_RESULTS", "general"),
    );
  });
});
