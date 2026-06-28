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

function makePrisma(sessionBatches: { id: string }[][]) {
  let call = 0;
  return {
    session: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(sessionBatches[call++] ?? [])),
      deleteMany: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve({ count: (where.id.in as string[]).length }),
      ),
    },
    message: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    feedback: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    safetyEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    voiceInteraction: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

describe("RetentionService", () => {
  it("deletes sessions older than the 90-day cutoff and excludes eval sessions", async () => {
    const prisma = makePrisma([[{ id: "s1" }, { id: "s2" }], []]);
    const service = new RetentionService(prisma as never);

    const result = await service.runRetention(NOW);

    // The eligibility query must filter on the 90-day cutoff and isEval=false.
    const where = prisma.session.findMany.mock.calls[0][0].where;
    expect(where.isEval).toBe(false);
    expect(where.createdAt.lt.toISOString()).toBe(EXPECTED_CUTOFF);

    expect(result.cutoff).toBe(EXPECTED_CUTOFF);
    expect(result.sessions).toBe(2);
  });

  it("deletes child rows before sessions and aggregates the counts", async () => {
    const prisma = makePrisma([[{ id: "s1" }, { id: "s2" }], []]);
    const service = new RetentionService(prisma as never);

    const result = await service.runRetention(NOW);

    expect(result.messages).toBe(3);
    expect(result.feedback).toBe(1);
    expect(result.safetyEvents).toBe(2);
    expect(result.voiceInteractions).toBe(0);

    // Sessions are deleted last (after their child rows) to respect FKs.
    const sessionDeleteOrder = prisma.session.deleteMany.mock.invocationCallOrder[0];
    expect(prisma.message.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(sessionDeleteOrder);
    expect(prisma.feedback.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(sessionDeleteOrder);
    expect(prisma.safetyEvent.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(sessionDeleteOrder);
  });

  it("does nothing when there are no eligible sessions", async () => {
    const prisma = makePrisma([[]]);
    const service = new RetentionService(prisma as never);

    const result = await service.runRetention(NOW);

    expect(result.sessions).toBe(0);
    expect(prisma.message.deleteMany).not.toHaveBeenCalled();
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it("paginates: continues past a full batch (500) and stops on a short one", async () => {
    const fullBatch = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}` }));
    const tail = [{ id: "last" }];
    const prisma = makePrisma([fullBatch, tail]); // 500 → keep going; 1 → stop
    const service = new RetentionService(prisma as never);

    const result = await service.runRetention(NOW);

    expect(prisma.session.findMany).toHaveBeenCalledTimes(2);
    expect(result.sessions).toBe(501);
  });
});
