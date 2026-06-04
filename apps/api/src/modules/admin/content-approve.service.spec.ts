/**
 * Unit tests for ContentApproveService.
 *
 * GCS is mocked via jest.spyOn on the private readQueue/writeQueue methods so
 * that the module-level `const GCS_BUCKET = process.env.QUEUE_GCS_BUCKET`
 * (captured at import time) never causes a "not configured" error.
 *
 * SocialPostService is mocked in-place so fire-and-forget social generation
 * does not make real network calls.
 */

import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { ContentApproveService } from "./content-approve.service";

// ---------------------------------------------------------------------------
// Mock @google-cloud/storage (prevents accidental real GCS calls even if the
// module-level constant were set)
// ---------------------------------------------------------------------------
jest.mock("@google-cloud/storage", () => ({
  Storage: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock SocialPostService (fire-and-forget — keep tests fast)
// ---------------------------------------------------------------------------
const mockGenerateAndQueue = jest.fn().mockResolvedValue(undefined);

jest.mock("./social-post.service", () => ({
  SocialPostService: jest.fn().mockImplementation(() => ({
    generateAndQueue: mockGenerateAndQueue,
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = "suchi-content-dev-secret";

function makeToken(slug: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(slug).digest("hex");
}

const SLUG = "test-article-slug";
const TITLE = "Test Article Title";

interface ArticleEntry {
  slug: string;
  title: string;
  contentType: string;
  status: string;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  approvalToken?: string;
}

function makeQueue(status: string, slug = SLUG): { articles: ArticleEntry[] } {
  return {
    articles: [
      {
        slug,
        title: TITLE,
        contentType: "education",
        status,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContentApproveService", () => {
  let service: ContentApproveService;
  let readQueueSpy: jest.SpyInstance;
  let writeQueueSpy: jest.SpyInstance;

  const { SocialPostService } = jest.requireMock("./social-post.service") as {
    SocialPostService: jest.Mock;
  };

  beforeEach(() => {
    delete process.env.CONTENT_APPROVAL_SECRET;
    jest.clearAllMocks();

    service = new ContentApproveService(new SocialPostService());

    // Spy on the private methods so individual tests can control GCS data
    // without needing a real bucket. Using `as any` to bypass TypeScript
    // private access — safe in test code only.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readQueueSpy = jest.spyOn(service as any, "readQueue");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    writeQueueSpy = jest.spyOn(service as any, "writeQueue").mockResolvedValue(undefined);
  });

  afterEach(() => {
    readQueueSpy.mockRestore();
    writeQueueSpy.mockRestore();
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  describe("approveArticle — idempotency", () => {
    it("returns early with title and does NOT write when article is already approved", async () => {
      readQueueSpy.mockResolvedValue(makeQueue("approved"));

      const result = await service.approveArticle(SLUG, makeToken(SLUG));

      expect(result.title).toBe(TITLE);
      // writeQueue must NOT have been called — no mutation of already-approved articles
      expect(writeQueueSpy).not.toHaveBeenCalled();
    });

    it("returns early with title and does NOT write when article is already rejected", async () => {
      readQueueSpy.mockResolvedValue(makeQueue("rejected"));

      const result = await service.approveArticle(SLUG, makeToken(SLUG));

      expect(result.title).toBe(TITLE);
      expect(writeQueueSpy).not.toHaveBeenCalled();
    });
  });

  describe("rejectArticle — idempotency", () => {
    it("returns early with title and does NOT write when article is already rejected", async () => {
      readQueueSpy.mockResolvedValue(makeQueue("rejected"));

      const result = await service.rejectArticle(SLUG, makeToken(SLUG));

      expect(result.title).toBe(TITLE);
      expect(writeQueueSpy).not.toHaveBeenCalled();
    });

    it("returns early with title and does NOT write when article is already approved", async () => {
      readQueueSpy.mockResolvedValue(makeQueue("approved"));

      const result = await service.rejectArticle(SLUG, makeToken(SLUG));

      expect(result.title).toBe(TITLE);
      expect(writeQueueSpy).not.toHaveBeenCalled();
    });
  });

  // ── Reviewer name ──────────────────────────────────────────────────────────

  describe("approveArticle — reviewer name (OD-006)", () => {
    it("sets approvedBy to the approver param when one is provided", async () => {
      const queue = makeQueue("pending");
      readQueueSpy.mockResolvedValue(queue);

      await service.approveArticle(SLUG, makeToken(SLUG), "gautam@dikshafoundation.org");

      expect(writeQueueSpy).toHaveBeenCalledTimes(1);
      const savedQueue = writeQueueSpy.mock.calls[0][0] as typeof queue;
      const entry = savedQueue.articles.find((a: ArticleEntry) => a.slug === SLUG)!;
      expect(entry.approvedBy).toBe("gautam@dikshafoundation.org");
      expect(entry.approvedBy).not.toBe("email_approval");
    });

    it("defaults approvedBy to 'email_approval' when no approver param is provided", async () => {
      const queue = makeQueue("pending");
      readQueueSpy.mockResolvedValue(queue);

      // Called without the optional approver argument
      await service.approveArticle(SLUG, makeToken(SLUG));

      expect(writeQueueSpy).toHaveBeenCalledTimes(1);
      const savedQueue = writeQueueSpy.mock.calls[0][0] as typeof queue;
      const entry = savedQueue.articles.find((a: ArticleEntry) => a.slug === SLUG)!;
      expect(entry.approvedBy).toBe("email_approval");
    });
  });

  // ── Token / auth guard ─────────────────────────────────────────────────────

  describe("token verification", () => {
    it("throws UnauthorizedException when the HMAC token is wrong", async () => {
      // readQueue should not even be reached, but set it up anyway
      readQueueSpy.mockResolvedValue(makeQueue("pending"));
      const badToken = makeToken(SLUG, "wrong-secret");

      await expect(service.approveArticle(SLUG, badToken)).rejects.toThrow(
        UnauthorizedException
      );
    });

    it("throws NotFoundException when the slug is not in the queue", async () => {
      const otherSlug = "nonexistent-slug";
      readQueueSpy.mockResolvedValue(makeQueue("pending", SLUG)); // queue only has SLUG

      // Token must be valid for otherSlug so auth passes before the lookup
      await expect(
        service.approveArticle(otherSlug, makeToken(otherSlug))
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Happy-path side-effects ────────────────────────────────────────────────

  describe("approveArticle — happy path", () => {
    it("marks entry as approved, writes the queue, and fires social generation", async () => {
      const queue = makeQueue("pending");
      readQueueSpy.mockResolvedValue(queue);

      const result = await service.approveArticle(SLUG, makeToken(SLUG));

      expect(result.title).toBe(TITLE);
      expect(writeQueueSpy).toHaveBeenCalledTimes(1);

      const savedQueue = writeQueueSpy.mock.calls[0][0] as typeof queue;
      const entry = savedQueue.articles.find((a: ArticleEntry) => a.slug === SLUG)!;
      expect(entry.status).toBe("approved");
      expect(entry.approvedAt).toBeDefined();

      // Fire-and-forget social generation — flush microtask queue
      await Promise.resolve();
      expect(mockGenerateAndQueue).toHaveBeenCalledWith(SLUG, TITLE, "education");
    });
  });
});
