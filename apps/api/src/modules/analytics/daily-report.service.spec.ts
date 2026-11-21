import { DailyReportService, NO_SOURCE_LABEL, tallySessionsBySource } from "./daily-report.service";
import { generateMarkdownReport } from "./report-generator";

describe("tallySessionsBySource", () => {
  it("counts by src, falls back to utm source, then to none", () => {
    const result = tallySessionsBySource([
      { channel: "web", src: "site-article" },
      { channel: "web", src: "site-article", utmSource: "instagram" },
      { channel: "web", src: "yt" },
      { channel: "web", utmSource: "instagram" },
      { channel: "web" },
      { channel: "whatsapp" },
      null,
    ]);
    expect(result).toEqual([
      { source: NO_SOURCE_LABEL, count: 3 },
      { source: "site-article", count: 2 },
      { source: "utm:instagram", count: 1 },
      { source: "yt", count: 1 },
    ]);
  });

  it("never echoes a stored value that fails the code rule", () => {
    const result = tallySessionsBySource([
      { src: "https://example.com/?q=secret" },
      { src: "Some Free Text" },
      { utmSource: "<b>x</b>" },
    ]);
    expect(result).toEqual([{ source: NO_SOURCE_LABEL, count: 3 }]);
  });
});

describe("DailyReportService sessionsBySource", () => {
  it("reads only session_created payloads for the window's real sessions", async () => {
    const realSessions = [{ id: "s-1" }, { id: "s-2" }];
    const analyticsFindMany = jest.fn().mockImplementation((args: any) => {
      if (args?.where?.eventName === "session_created") {
        return Promise.resolve([{ payload: { channel: "web", src: "qr-poster" } }, { payload: { channel: "web" } }]);
      }
      return Promise.resolve([]);
    });
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(realSessions),
      message: { findMany: jest.fn().mockResolvedValue([]) },
      feedback: { findMany: jest.fn().mockResolvedValue([]) },
      safetyEvent: { findMany: jest.fn().mockResolvedValue([]) },
      analyticsEvent: { findMany: analyticsFindMany },
      session: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new DailyReportService(prisma as any);
    const metrics = await service.generateMetrics(new Date("2026-11-20T00:00:00Z"), new Date("2026-11-21T00:00:00Z"));

    expect(metrics.sessionsBySource).toEqual([
      { source: NO_SOURCE_LABEL, count: 1 },
      { source: "qr-poster", count: 1 },
    ]);
    const call = analyticsFindMany.mock.calls.find((c: any[]) => c[0]?.where?.eventName === "session_created")[0];
    expect(call.where.sessionId).toEqual({ in: ["s-1", "s-2"] });
    expect(call.select).toEqual({ payload: true });

    const md = generateMarkdownReport(metrics);
    expect(md).toContain("### Sessions Started, by Source");
    expect(md).toContain("- qr-poster: 1");
  });
});
