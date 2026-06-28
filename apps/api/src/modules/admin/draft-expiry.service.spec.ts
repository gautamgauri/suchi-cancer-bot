/**
 * Unit tests for DraftExpiryService — FR-AUDIT-007.
 *
 *   Article  sent_for_review > 48h → reminder (once);  > 30d → archive
 *   Social   sent_for_approval > 3d → reminder (once);  > 7d → expire (rejected)
 *
 * GCS is mocked via @google-cloud/storage. QUEUE_GCS_BUCKET must be set BEFORE
 * the module is loaded (it captures the const at import time), so the service
 * is pulled in with require() after the env is set. EmailService is stubbed.
 */

process.env.QUEUE_GCS_BUCKET = "test-bucket";

// In-memory file store the mocked Storage reads from / writes to.
const mockFiles: Record<string, string> = {};
const mockWrites: Record<string, string> = {};

jest.mock("@google-cloud/storage", () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: () => ({
      file: (name: string) => ({
        download: async () => {
          if (mockFiles[name] === undefined) throw new Error(`no such object: ${name}`);
          return [Buffer.from(mockFiles[name])];
        },
        save: async (content: string) => {
          mockWrites[name] = content;
        },
      }),
    }),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DraftExpiryService } = require("./draft-expiry.service");

const NOW = new Date("2026-06-24T00:00:00.000Z");

// Relative-to-NOW timestamps
const H = 60 * 60 * 1000;
const D = 24 * H;
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

describe("DraftExpiryService", () => {
  let service: InstanceType<typeof DraftExpiryService>;
  let sendEmail: jest.Mock;

  beforeEach(() => {
    for (const k of Object.keys(mockFiles)) delete mockFiles[k];
    for (const k of Object.keys(mockWrites)) delete mockWrites[k];
    sendEmail = jest.fn().mockResolvedValue(undefined);
    service = new DraftExpiryService({ sendEmail } as never);
  });

  it("reminds stale articles (>48h), archives old ones (>30d), skips fresh ones", async () => {
    mockFiles["content-queue.json"] = JSON.stringify({
      articles: [
        { slug: "stale", title: "Stale", status: "sent_for_review", emailSentAt: iso(50 * H) },
        { slug: "old", title: "Old", status: "sent_for_review", emailSentAt: iso(31 * D) },
        { slug: "fresh", title: "Fresh", status: "sent_for_review", emailSentAt: iso(10 * H) },
        { slug: "done", title: "Done", status: "approved", emailSentAt: iso(60 * D) },
      ],
    });
    mockFiles["social-queue.json"] = JSON.stringify({ posts: [] });

    const result = await service.runExpiry(NOW);

    expect(result.articles.reminded).toEqual(["stale"]);
    expect(result.articles.archived).toEqual(["old"]);
    // fresh (not yet 48h) + done (wrong status) are skipped
    expect(result.articles.skipped).toBe(2);

    // The written queue reflects the new statuses.
    const written = JSON.parse(mockWrites["content-queue.json"]);
    const old = written.articles.find((a: { slug: string }) => a.slug === "old");
    expect(old.status).toBe("archived");
    expect(old.archivedAt).toBeDefined();
    const stale = written.articles.find((a: { slug: string }) => a.slug === "stale");
    expect(stale.reminderSentAt).toBeDefined();

    // Reminder + archive emails fired.
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("does not re-remind an article that already has reminderSentAt", async () => {
    mockFiles["content-queue.json"] = JSON.stringify({
      articles: [
        {
          slug: "already",
          title: "Already reminded",
          status: "sent_for_review",
          emailSentAt: iso(50 * H),
          reminderSentAt: iso(2 * H),
        },
      ],
    });
    mockFiles["social-queue.json"] = JSON.stringify({ posts: [] });

    const result = await service.runExpiry(NOW);

    expect(result.articles.reminded).toEqual([]);
    expect(result.articles.skipped).toBe(1);
    expect(mockWrites["content-queue.json"]).toBeUndefined(); // nothing dirty → no write
  });

  it("reminds social posts (>3d) and expires old ones (>7d) to rejected", async () => {
    mockFiles["content-queue.json"] = JSON.stringify({ articles: [] });
    mockFiles["social-queue.json"] = JSON.stringify({
      posts: [
        { id: "p-remind", title: "Remind", status: "sent_for_approval", createdAt: iso(4 * D) },
        { id: "p-expire", title: "Expire", status: "sent_for_approval", createdAt: iso(8 * D) },
        { id: "p-fresh", title: "Fresh", status: "sent_for_approval", createdAt: iso(1 * D) },
      ],
    });

    const result = await service.runExpiry(NOW);

    expect(result.social.reminded).toEqual(["p-remind"]);
    expect(result.social.expired).toEqual(["p-expire"]);
    expect(result.social.skipped).toBe(1);

    const written = JSON.parse(mockWrites["social-queue.json"]);
    const expired = written.posts.find((p: { id: string }) => p.id === "p-expire");
    expect(expired.status).toBe("rejected");
    expect(expired.expiredAt).toBeDefined();
  });

  it("returns an empty result and skips entirely when the bucket is unset", async () => {
    // Re-load the module with no bucket configured.
    jest.resetModules();
    const saved = process.env.QUEUE_GCS_BUCKET;
    delete process.env.QUEUE_GCS_BUCKET;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DraftExpiryService: Fresh } = require("./draft-expiry.service");
    const svc = new Fresh({ sendEmail } as never);

    const result = await svc.runExpiry(NOW);

    expect(result.articles.archived).toEqual([]);
    expect(result.social.expired).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();

    process.env.QUEUE_GCS_BUCKET = saved;
  });
});
