import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ChatDto } from "./dto";

/**
 * Pins the "citations are for auditors, not users" contract at the boundary
 * where it is actually enforced (issue #71, related to #54).
 *
 * `ChatController.send()` strips raw citation markers, leftover numbered refs
 * and the raw "**Sources:**" block from `responseText` before the client sees
 * it, while leaving the structured `citations` array intact for auditing.
 *
 * This had no test. The only assertions on it lived in `apps/web/e2e`, which
 * asserted the OPPOSITE — that `[1]` and a "Sources" section are visible in
 * the browser — and so could never pass against the real service. Those specs
 * are corrected in the same change; this spec is what actually guards the
 * contract, because it runs in CI on every PR.
 */
describe("ChatController — user-facing response text", () => {
  const dto: ChatDto = {
    sessionId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
    channel: "web",
    userText: "What is chemotherapy?",
  };

  function controllerReturning(responseText: string) {
    const chat = {
      handle: jest.fn().mockResolvedValue({
        sessionId: dto.sessionId,
        messageId: "msg-1",
        responseText,
        citations: [{ docId: "nci-chemo", chunkId: "c3", position: 0 }],
        safety: { classification: "normal", actions: [] },
      }),
    } as unknown as ChatService;

    return new ChatController(chat);
  }

  it("strips [citation:docId:chunkId] markers", async () => {
    const controller = controllerReturning(
      "Chemotherapy uses medicines to kill cancer cells [citation:nci-chemo:c3].",
    );

    const result = await controller.send(dto);

    expect(result.responseText).toBe(
      "Chemotherapy uses medicines to kill cancer cells.",
    );
    expect(result.responseText).not.toMatch(/\[citation:/);
  });

  it("strips leftover numbered references like [1]", async () => {
    const controller = controllerReturning(
      "Chemotherapy is a systemic treatment [1]. It is often combined with surgery [2].",
    );

    const result = await controller.send(dto);

    expect(result.responseText).not.toMatch(/\[\d+\]/);
    expect(result.responseText).toBe(
      "Chemotherapy is a systemic treatment. It is often combined with surgery.",
    );
  });

  it("strips the raw **Sources:** block appended by citation repair", async () => {
    const controller = controllerReturning(
      "Chemotherapy uses medicines to kill cancer cells.\n\n" +
        "**Sources:** [citation:nci-chemo:c3] [citation:nci-chemo:c4]",
    );

    const result = await controller.send(dto);

    expect(result.responseText).toBe(
      "Chemotherapy uses medicines to kill cancer cells.",
    );
    expect(result.responseText).not.toMatch(/Sources/i);
  });

  it("leaves the structured citations array intact for auditing", async () => {
    const controller = controllerReturning(
      "Chemotherapy uses medicines to kill cancer cells [citation:nci-chemo:c3].",
    );

    const result = await controller.send(dto);

    // The markers go; the audit trail stays. Both halves matter — stripping
    // the citations too would silently end citation auditing.
    expect(result.citations).toEqual([
      { docId: "nci-chemo", chunkId: "c3", position: 0 },
    ]);
  });

  it("removes the space a stripped marker would otherwise leave before punctuation", async () => {
    // Regression: the marker pattern used not to consume the preceding space,
    // so every citation at the end of a sentence shipped as "cells ." to users.
    const controller = controllerReturning(
      "Chemotherapy is systemic [citation:nci-chemo:c3], surgery is local [citation:nci-surg:c1].",
    );

    const result = await controller.send(dto);

    expect(result.responseText).toBe(
      "Chemotherapy is systemic, surgery is local.",
    );
    expect(result.responseText).not.toMatch(/\s[.,]/);
  });

  it("keeps paragraph breaks when a marker starts a line", async () => {
    // The marker pattern eats horizontal whitespace only, so it must not
    // swallow a newline and glue two paragraphs together.
    const controller = controllerReturning(
      "Chemotherapy is a systemic treatment.\n\n[citation:nci-chemo:c3] Surgery is local.",
    );

    const result = await controller.send(dto);

    expect(result.responseText).toBe(
      "Chemotherapy is a systemic treatment.\n\n Surgery is local.",
    );
    expect(result.responseText).toContain("\n\n");
  });

  it("keeps the escalated reply's header break so bannerText stays a byte-exact prefix of responseText (issue #135)", async () => {
    // Live prod 2026-09-13 (seed 1789272008, q02): the critical template's
    // `…emergency.**\n\n**Call for help NOW:**` reached the bubble as
    // `…emergency.Call for help NOW:` while the banner (never cleaned) was
    // intact — breaking the #111 invariant that bannerText prefixes responseText.
    const bannerText =
      "⚠️ **This sounds like a medical emergency.**\n\n**Call for help NOW:**\n• **112** — National emergency number (police, fire, ambulance)\n• **108** — Free ambulance service (available in most states)\n• **102** — Medical emergency helpline";
    const chat = {
      handle: jest.fn().mockResolvedValue({
        sessionId: dto.sessionId,
        messageId: "msg-2",
        responseText: bannerText,
        citations: [],
        safety: {
          classification: "red_flag",
          actions: ["show_emergency_banner", "end_conversation"],
          bannerText,
        },
      }),
    } as unknown as ChatService;

    const result = await new ChatController(chat).send(dto);

    expect(result.responseText.startsWith(result.safety.bannerText)).toBe(true);
    expect(result.responseText).toContain("medical emergency.**\n\n**Call for help NOW:**");
  });

  it("does not mangle ordinary prose that merely contains brackets or numbers", async () => {
    const controller = controllerReturning(
      "Screening is usually offered from age 40 (see your doctor about timing).",
    );

    const result = await controller.send(dto);

    expect(result.responseText).toBe(
      "Screening is usually offered from age 40 (see your doctor about timing).",
    );
  });
});
