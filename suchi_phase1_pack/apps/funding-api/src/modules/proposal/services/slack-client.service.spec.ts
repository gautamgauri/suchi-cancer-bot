import { ConfigService } from "@nestjs/config";
import { GovernanceDeliveryGuard } from "../../notifications/governance-delivery.guard";
import { SlackClientService } from "./slack-client.service";

describe("SlackClientService governance", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (global as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
  });

  function makeConfig(env: Record<string, string | undefined>): ConfigService {
    return {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
  }

  it("blocks non-whitelisted Slack channels", async () => {
    const config = makeConfig({
      FUNDING_SLACK_WEBHOOK_URL: "https://hooks.slack.test/abc",
      FUNDING_SLACK_CHANNEL: "#public-channel",
      FUNDING_BLOCK_EXTERNAL_DELIVERY: "true",
      FUNDING_ALLOWED_SLACK_CHANNEL_IDS: "#funding-bot",
      FUNDING_WRITE_APPROVAL_TOKEN: "approve-1",
    });
    const guard = new GovernanceDeliveryGuard(config);
    const svc = new SlackClientService(config, guard);

    const result = await svc.postProgress({
      opportunityId: "opp-1",
      stage: "planning",
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
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("posts to whitelisted channel with approval", async () => {
    const config = makeConfig({
      FUNDING_SLACK_WEBHOOK_URL: "https://hooks.slack.test/abc",
      FUNDING_SLACK_CHANNEL: "#funding-bot",
      FUNDING_BLOCK_EXTERNAL_DELIVERY: "true",
      FUNDING_ALLOWED_SLACK_CHANNEL_IDS: "#funding-bot",
      FUNDING_WRITE_APPROVAL_TOKEN: "approve-1",
    });
    const guard = new GovernanceDeliveryGuard(config);
    const svc = new SlackClientService(config, guard);

    const result = await svc.postProgress({
      opportunityId: "opp-1",
      stage: "planning",
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
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
