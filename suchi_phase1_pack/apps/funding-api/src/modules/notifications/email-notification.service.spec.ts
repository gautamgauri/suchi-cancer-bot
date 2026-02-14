import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { EmailNotificationService } from "./email-notification.service";
import { GovernanceDeliveryGuard } from "./governance-delivery.guard";

jest.mock("nodemailer");

describe("EmailNotificationService governance", () => {
  const sendMail = jest.fn();
  const mockedCreateTransport = nodemailer.createTransport as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({ messageId: "msg-1" });
  });

  function makeConfig(env: Record<string, string | undefined>): ConfigService {
    return {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
  }

  it("blocks external recipients even with approval token", async () => {
    const config = makeConfig({
      SMTP_HOST: "smtp.local",
      SMTP_PORT: "587",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      FUNDING_REVIEW_RECIPIENTS: "outside@gmail.com",
      FUNDING_BLOCK_EXTERNAL_DELIVERY: "true",
      FUNDING_ALLOWED_EMAIL_RECIPIENTS: "internal@suchi.org",
      FUNDING_WRITE_APPROVAL_TOKEN: "approve-1",
    });
    const guard = new GovernanceDeliveryGuard(config);
    const svc = new EmailNotificationService(config, guard);

    const result = await svc.send({
      subject: "s",
      body: "b",
      approval: {
        approvalToken: "approve-1",
        interactionId: "i",
        outcome: "approved",
        actor: { actorType: "human", actorId: "u1" },
        timestamp: new Date().toISOString(),
      },
    });

    expect(result.sent).toBe(false);
    expect(result.blocked).toBe(true);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("allows internal recipients with valid approval", async () => {
    const config = makeConfig({
      SMTP_HOST: "smtp.local",
      SMTP_PORT: "587",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      FUNDING_REVIEW_RECIPIENTS: "reviewer@suchi.org",
      FUNDING_BLOCK_EXTERNAL_DELIVERY: "true",
      FUNDING_ALLOWED_EMAIL_RECIPIENTS: "reviewer@suchi.org",
      FUNDING_WRITE_APPROVAL_TOKEN: "approve-1",
    });
    const guard = new GovernanceDeliveryGuard(config);
    const svc = new EmailNotificationService(config, guard);

    const result = await svc.send({
      subject: "s",
      body: "b",
      approval: {
        approvalToken: "approve-1",
        interactionId: "i",
        outcome: "approved",
        actor: { actorType: "human", actorId: "u1" },
        timestamp: new Date().toISOString(),
      },
    });

    expect(result.sent).toBe(true);
    expect(result.blocked).toBe(false);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
