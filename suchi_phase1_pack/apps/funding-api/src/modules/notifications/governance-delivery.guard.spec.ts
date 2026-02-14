import { ConfigService } from "@nestjs/config";
import { GovernanceDeliveryGuard } from "./governance-delivery.guard";

describe("GovernanceDeliveryGuard", () => {
  const makeConfig = (env: Record<string, string | undefined>) =>
    ({
      get: jest.fn((key: string) => env[key]),
    }) as unknown as ConfigService;

  it("blocks non-whitelisted email recipients", () => {
    const guard = new GovernanceDeliveryGuard(
      makeConfig({
        FUNDING_BLOCK_EXTERNAL_DELIVERY: "true",
        FUNDING_ALLOWED_EMAIL_RECIPIENTS: "internal@suchi.org",
      }),
    );

    const result = guard.evaluateDelivery({
      medium: "email",
      requestedBy: { actorType: "agent", actorId: "test" },
      reason: "unit-test",
      timestamp: new Date().toISOString(),
      email: { recipients: ["external@gmail.com"] },
    });

    expect(result.decision).toBe("block");
    expect(result.blockedTargets).toContain("external@gmail.com");
  });

  it("allows whitelisted slack channel", () => {
    const guard = new GovernanceDeliveryGuard(
      makeConfig({
        FUNDING_BLOCK_EXTERNAL_DELIVERY: "true",
        FUNDING_ALLOWED_SLACK_CHANNEL_IDS: "#funding-bot",
      }),
    );

    const result = guard.evaluateDelivery({
      medium: "slack",
      requestedBy: { actorType: "agent", actorId: "test" },
      reason: "unit-test",
      timestamp: new Date().toISOString(),
      slack: { channelId: "#funding-bot" },
    });

    expect(result.decision).toBe("allow");
  });

  it("allows any slack channel when wildcard is configured", () => {
    const guard = new GovernanceDeliveryGuard(
      makeConfig({
        FUNDING_BLOCK_EXTERNAL_DELIVERY: "true",
        FUNDING_ALLOWED_SLACK_CHANNEL_IDS: "*",
      }),
    );

    const result = guard.evaluateDelivery({
      medium: "slack",
      requestedBy: { actorType: "agent", actorId: "test" },
      reason: "unit-test",
      timestamp: new Date().toISOString(),
      slack: { channelId: "#general" },
    });

    expect(result.decision).toBe("allow");
    expect(result.allowedTargets).toContain("#general");
  });

  it("allows delivery in non-blocking mode and surfaces advisory violation", () => {
    const guard = new GovernanceDeliveryGuard(
      makeConfig({
        FUNDING_BLOCK_EXTERNAL_DELIVERY: "false",
        FUNDING_ALLOWED_EMAIL_RECIPIENTS: "internal@suchi.org",
      }),
    );

    const result = guard.evaluateDelivery({
      medium: "email",
      requestedBy: { actorType: "agent", actorId: "test" },
      reason: "unit-test",
      timestamp: new Date().toISOString(),
      email: { recipients: ["external@gmail.com"] },
    });

    expect(result.decision).toBe("allow");
    expect(result.violationCodes).toContain("EXTERNAL_DELIVERY_ALLOWED_BY_CONFIG");
  });

  it("returns preview when approval is missing", () => {
    const guard = new GovernanceDeliveryGuard(
      makeConfig({
        FUNDING_WRITE_APPROVAL_TOKEN: "secret-token",
      }),
    );
    const result = guard.requireWriteApproval({
      module: "draft",
      action: "send",
      entityType: "email_message",
      entityId: "email-1",
      actor: { actorType: "agent", actorId: "test" },
      reason: "unit-test",
      before: null,
      after: { hello: "world" },
      approval: undefined,
    });

    expect(result.approved).toBe(false);
    expect(result.preview.after).toEqual({ hello: "world" });
  });

  it("marks numeric claims without citations as unverified", () => {
    const guard = new GovernanceDeliveryGuard(makeConfig({}));
    const result = guard.enforceNumericClaimDiscipline(
      "Budget is INR 2000000.\nThis line has [citation:doc:chunk] and 42 numbers.",
    );
    expect(result.flaggedCount).toBe(1);
    expect(result.text).toContain("UNVERIFIED_NUMERIC_CLAIM");
  });
});
