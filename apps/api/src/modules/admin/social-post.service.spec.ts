/**
 * Unit tests for SocialPostService — the social-post safety gate.
 *
 * Safety-critical contract (FR-SOCIAL-013 / FR-SAFETY-006, OD-004):
 * a draft flagged `safetyBlocked` must NEVER publish, regardless of reviewer
 * action. `approvePost()` must throw ForbiddenException and not mutate the
 * queue or call any platform API.
 *
 * GCS is avoided by spying on the private loadQueue/saveQueue; LlmService and
 * EmailService are stubbed (no network).
 */

import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { SocialPostService } from "./social-post.service";

jest.mock("@google-cloud/storage", () => ({ Storage: jest.fn() }));

type Platform = "facebook" | "instagram" | "linkedin";

interface Draft {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  articleUrl: string;
  copy: Record<Platform, string>;
  status: string;
  approvalToken?: string;
  createdAt: string;
  safetyWarnings?: string[];
  safetyBlocked?: boolean;
  approvedBy?: string;
  rejectedBy?: string;
  approvedPlatforms?: Platform[];
}

const ID = "post-123";
const TITLE = "Test Social Post";

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: ID,
    slug: "test-slug",
    title: TITLE,
    contentType: "treatment",
    articleUrl: "https://suchicancercare.org/x",
    copy: { facebook: "fb", instagram: "ig", linkedin: "li" },
    status: "sent_for_approval",
    createdAt: "2026-06-01T00:00:00.000Z",
    safetyBlocked: false,
    ...overrides,
  };
}

describe("SocialPostService — safety gate", () => {
  let service: SocialPostService;
  let saveQueueSpy: jest.SpyInstance;
  let validToken: string;

  const llmStub = {} as never;
  const emailStub = { send: jest.fn() } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SocialPostService(llmStub, emailStub);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveQueueSpy = jest.spyOn(service as any, "saveQueue").mockResolvedValue(undefined);
    // No platforms configured → no network calls on the happy path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service as any, "resolvePlatforms").mockReturnValue([]);
    // confirmation email is fire-and-forget; stub to a no-op promise
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service as any, "sendConfirmationEmail").mockResolvedValue(undefined);

    // Generate a token the service itself accepts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validToken = (service as any).buildToken(ID);
  });

  function stubQueue(draft: Draft) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service as any, "loadQueue").mockResolvedValue({ posts: [draft] });
  }

  // ── Hard block ────────────────────────────────────────────────────────────

  describe("approvePost — hard block (FR-SOCIAL-013)", () => {
    it("throws ForbiddenException and does NOT publish a safetyBlocked draft", async () => {
      const draft = makeDraft({ safetyBlocked: true, safetyWarnings: ["cure claim"] });
      stubQueue(draft);

      await expect(service.approvePost(ID, validToken)).rejects.toThrow(ForbiddenException);

      // The queue must not be mutated and status must remain unpublished.
      expect(saveQueueSpy).not.toHaveBeenCalled();
      expect(draft.status).toBe("sent_for_approval");
    });

    it("allows a non-blocked draft past the gate and marks it published", async () => {
      const draft = makeDraft({ safetyBlocked: false });
      stubQueue(draft);

      const result = await service.approvePost(ID, validToken, undefined, "Gautam");

      expect(result.title).toBe(TITLE);
      expect(saveQueueSpy).toHaveBeenCalledTimes(1);
      expect(draft.status).toBe("published");
      expect(draft.approvedBy).toBe("Gautam");
    });
  });

  // ── Idempotency (FR-SOCIAL-007) ─────────────────────────────────────────────

  describe("approvePost — idempotency", () => {
    it.each(["published", "rejected"])(
      "returns early without throwing or re-saving when already %s",
      async (status) => {
        const draft = makeDraft({ status, approvedBy: "Divya", approvedPlatforms: ["facebook"] });
        stubQueue(draft);

        const result = await service.approvePost(ID, validToken, undefined, "Nisha");

        expect(result.title).toBe(TITLE);
        expect(saveQueueSpy).not.toHaveBeenCalled();
      },
    );

    it("blocks a safetyBlocked draft even if a duplicate click arrives (block before publish-state check passes)", async () => {
      // status still sent_for_approval but blocked — must throw, not publish
      const draft = makeDraft({ safetyBlocked: true });
      stubQueue(draft);
      await expect(service.approvePost(ID, validToken)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Auth + lookup guards ────────────────────────────────────────────────────

  describe("approvePost — guards", () => {
    it("throws UnauthorizedException on a bad token", async () => {
      stubQueue(makeDraft());
      await expect(service.approvePost(ID, "deadbeef")).rejects.toThrow(UnauthorizedException);
    });

    it("throws NotFoundException when the post id is not in the queue", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, "loadQueue").mockResolvedValue({ posts: [] });
      await expect(service.approvePost(ID, validToken)).rejects.toThrow(NotFoundException);
    });
  });
});
