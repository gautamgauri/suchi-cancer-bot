/**
 * Unit tests for RetentionService — NFR-PRIV-001 / NFR-PRIV-002.
 *
 * Contract: delete conversation data older than 90 days; NEVER delete eval
 * sessions (isEval=true); aggregate counts; paginate in batches of 500.
 *
 * PrismaService is mocked — no DB. `now` is injected for deterministic cutoff.
 */

import { RetentionService } from "./retention.service";

const NOW = new Date("2026-06-24T00:00:00.000Z");
const EXPECTED_CUTOFF = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
const EXPECTED_CUTOFF_365 = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

function makePrisma(sessionBatches90: { id: string }[][], sessionBatches365: { id: string }[][]) {
  let call90 = 0;
  let call365 = 0;
  return {
    session: {
      findMany: jest.fn().mockImplementation(({ where }) => {
        const cutoff = where.createdAt.lt;
        const cutoff90 = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
        const is90 = Math.abs(cutoff.getTime() - cutoff90.getTime()) < 10000;
        if (is90) {
          return Promise.resolve(sessionBatches90[call90++] ?? []);
        } else {
          return Promise.resolve(sessionBatches365[call365++] ?? []);
        }
      }),
      deleteMany: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve({ count: (where.id.in as string[]).length }),
      ),
    },
    message: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    feedback: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    safetyEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    voiceInteraction: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    whatsAppContact: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
  };
}

describe("RetentionService", () => {
  it("deletes sessions older than the 90-day cutoff and excludes eval sessions", async () => {
    const prisma = makePrisma([[{ id: "s1" }, { id: "s2" }], []], [[{ id: "s1" }, { id: "s2" }], []]);
    const service = new RetentionService(prisma as never);

    const result = await service.runRetention(NOW);

    // Call 0 should be the 90-day query.
    const where90 = prisma.session.findMany.mock.calls[0][0].where;
    expect(where90.isEval).toBe(false);
    expect(where90.createdAt.lt.toISOString()).toBe(EXPECTED_CUTOFF);

    // Call 1 should be the 365-day query.
    const where365 = prisma.session.findMany.mock.calls[1][0].where;
    expect(where365.isEval).toBe(false);
    expect(where365.createdAt.lt.toISOString()).toBe(EXPECTED_CUTOFF_365);

    expect(result.cutoff).toBe(EXPECTED_CUTOFF);
    expect(result.sessions).toBe(2);
  });

  it("deletes child rows before sessions and aggregates the counts", async () => {
    const prisma = makePrisma([[{ id: "s1" }, { id: "s2" }], []], [[{ id: "s1" }, { id: "s2" }], []]);
    const service = new RetentionService(prisma as never);

    const result = await service.runRetention(NOW);

    expect(result.messages).toBe(3);
    expect(result.feedback).toBe(1);
    expect(result.safetyEvents).toBe(2);
    expect(result.voiceInteractions).toBe(0);
    expect(result.whatsAppContacts).toBe(4); // from the lastActiveAt fallback query only

    // Sessions are deleted last (after their child rows) to respect FKs.
    const sessionDeleteOrder = prisma.session.deleteMany.mock.invocationCallOrder[0];
    expect(prisma.message.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(sessionDeleteOrder);
    expect(prisma.feedback.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(sessionDeleteOrder);
    expect(prisma.safetyEvent.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(sessionDeleteOrder);
  });

  it("does nothing when there are no eligible sessions", async () => {
    const prisma = makePrisma([[]], [[]]);
    const service = new RetentionService(prisma as never);

    const result = await service.runRetention(NOW);

    expect(result.sessions).toBe(0);
    expect(prisma.message.deleteMany).not.toHaveBeenCalled();
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it("paginates: continues past a full batch (500) and stops on a short one", async () => {
    const fullBatch = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}` }));
    const tail = [{ id: "last" }];
    const prisma = makePrisma([fullBatch, tail], [fullBatch, tail]);
    const service = new RetentionService(prisma as never);

    const result = await service.runRetention(NOW);

    expect(prisma.session.findMany).toHaveBeenCalledTimes(4); // 2 in 90-day phase, 2 in 365-day phase
    expect(result.sessions).toBe(501);
  });
});
