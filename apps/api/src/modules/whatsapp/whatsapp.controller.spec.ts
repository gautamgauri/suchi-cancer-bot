import { ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { WhatsAppController } from "./whatsapp.controller";
import { InboundMessage, MetaWebhookBody } from "./whatsapp.types";

const BODY = {} as MetaWebhookBody;
const REQ = { rawBody: Buffer.from("{}") } as any;
const MSG: InboundMessage = { wamid: "w1", from: "9199", text: "hi" };

describe("WhatsAppController", () => {
  let svc: any;
  let ctrl: WhatsAppController;

  beforeEach(() => {
    svc = {
      verifySignature: jest.fn().mockReturnValue(true),
      parseInbound: jest.fn().mockReturnValue([MSG]),
      claimInbound: jest.fn().mockResolvedValue({ claimed: [MSG] }),
      processClaimed: jest.fn().mockResolvedValue(undefined),
      verifyHandshake: jest.fn().mockReturnValue("CH"),
    };
    ctrl = new WhatsAppController(svc);
  });

  it("rejects an unsigned webhook and does not touch the pipeline (FR-WA-005)", async () => {
    svc.verifySignature.mockReturnValue(false);
    await expect(ctrl.receive(REQ, "sha256=bad", BODY)).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.claimInbound).not.toHaveBeenCalled();
    expect(svc.processClaimed).not.toHaveBeenCalled();
  });

  it("durably claims the message before acking, then processes out-of-band", async () => {
    // processClaimed must not be awaited (FR-WA-006) — a never-settling promise
    // still has to let the ACK return.
    svc.processClaimed.mockReturnValue(new Promise(() => undefined));

    const res = await ctrl.receive(REQ, "sha256=ok", BODY);

    expect(res).toEqual({ received: 1, accepted: 1 });
    expect(svc.claimInbound).toHaveBeenCalledWith([MSG]);
    expect(svc.processClaimed).toHaveBeenCalledWith([MSG]);
    expect(svc.claimInbound.mock.invocationCallOrder[0]).toBeLessThan(
      svc.processClaimed.mock.invocationCallOrder[0],
    );
  });

  it("acks with accepted:0 for a duplicate delivery and runs no pipeline work", async () => {
    svc.claimInbound.mockResolvedValue({ claimed: [] });
    const res = await ctrl.receive(REQ, "sha256=ok", BODY);
    expect(res).toEqual({ received: 1, accepted: 0 });
    expect(svc.processClaimed).toHaveBeenCalledWith([]);
  });

  it("refuses to ack when the message could not be recorded, so Meta retries", async () => {
    svc.claimInbound.mockResolvedValue({ claimed: [], failure: new Error("db down") });
    await expect(ctrl.receive(REQ, "sha256=ok", BODY)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("processes the messages it did claim even when a later one fails to record", async () => {
    svc.claimInbound.mockResolvedValue({ claimed: [MSG], failure: new Error("db down") });
    await expect(ctrl.receive(REQ, "sha256=ok", BODY)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(svc.processClaimed).toHaveBeenCalledWith([MSG]);
  });

  it("does not reject the ACK when async processing rejects", async () => {
    svc.processClaimed.mockRejectedValue(new Error("pipeline exploded"));
    await expect(ctrl.receive(REQ, "sha256=ok", BODY)).resolves.toEqual({
      received: 1,
      accepted: 1,
    });
  });

  it("echoes the verification challenge (FR-WA-004)", () => {
    expect(ctrl.verify("subscribe", "tok", "CH")).toBe("CH");
  });
});
