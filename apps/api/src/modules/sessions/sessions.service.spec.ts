import { SessionsService } from "./sessions.service";

describe("SessionsService.create attribution", () => {
  const makeService = () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "s-1", createdAt: new Date("2026-11-21T00:00:00Z") }]),
    };
    const analytics = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new SessionsService(prisma as any, analytics as any);
    return { service, analytics };
  };

  it("records src and utmSource in the session_created payload", async () => {
    const { service, analytics } = makeService();
    await service.create({ channel: "web" } as any, undefined, false, { src: "site-article", utmSource: "instagram" });
    expect(analytics.emit).toHaveBeenCalledWith(
      "session_created",
      expect.objectContaining({ channel: "web", src: "site-article", utmSource: "instagram" }),
      "s-1",
    );
  });

  it("leaves both keys out when there is no attribution", async () => {
    const { service, analytics } = makeService();
    await service.create({ channel: "web" } as any);
    const payload = analytics.emit.mock.calls[0][1];
    expect(payload).not.toHaveProperty("src");
    expect(payload).not.toHaveProperty("utmSource");
  });

  it("does not write attribution into the Session row", async () => {
    const { service } = makeService();
    const prisma = (service as any).prisma;
    await service.create({ channel: "web" } as any, undefined, false, { src: "site-article" });
    const values = prisma.$queryRaw.mock.calls[0].slice(1);
    expect(values).not.toContain("site-article");
  });
});
