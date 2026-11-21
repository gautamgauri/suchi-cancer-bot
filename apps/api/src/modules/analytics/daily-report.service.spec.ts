import {
  DailyReportService,
  NO_SOURCE_LABEL,
  SOURCE_REPORT_LIMIT,
  otherSourcesLabel,
  tallySessionsBySource,
} from "./daily-report.service";
import { generateMarkdownReport } from "./report-generator";

describe("tallySessionsBySource", () => {
  it("counts by src, falls back to utm source, then to channel or none", () => {
    const result = tallySessionsBySource([
      { channel: "web", src: "site-article" },
      { channel: "web", src: "site-article", utmSource: "instagram" },
      { channel: "web", src: "yt" },
      { channel: "web", utmSource: "instagram" },
      { channel: "web" },
      { channel: "web" },
      { channel: "whatsapp" },
      null,
    ]);
    expect(result).toEqual([
      { source: NO_SOURCE_LABEL, count: 3 },
      { source: "site-article", count: 2 },
      { source: "channel:whatsapp", count: 1 },
      { source: "utm:instagram", count: 1 },
      { source: "yt", count: 1 },
    ]);
  });

  it("keeps WhatsApp sessions apart from untagged web sessions", () => {
    const result = tallySessionsBySource([
      { channel: "whatsapp" },
      { channel: "whatsapp" },
      { channel: "web" },
      {},
    ]);
    expect(result).toEqual([
      { source: NO_SOURCE_LABEL, count: 2 },
      { source: "channel:whatsapp", count: 2 },
    ]);
  });

  it("prefers a code over the channel when a non-web session carries one", () => {
    expect(tallySessionsBySource([{ channel: "whatsapp", src: "qr-poster" }])).toEqual([
      { source: "qr-poster", count: 1 },
    ]);
  });

  it("prints the top 20 sources and folds the rest into one other line", () => {
    // 25 codes. code-00 has 30 sessions, code-01 has 29, and so on down to code-24 with 6.
    const payloads: unknown[] = [];
    for (let i = 0; i < 25; i++) {
      const code = `code-${String(i).padStart(2, "0")}`;
      for (let n = 0; n < 30 - i; n++) payloads.push({ channel: "web", src: code });
    }
    const result = tallySessionsBySource(payloads);
    expect(result).toHaveLength(SOURCE_REPORT_LIMIT + 1);
    expect(result[0]).toEqual({ source: "code-00", count: 30 });
    expect(result[19]).toEqual({ source: "code-19", count: 11 });
    // code-20 to code-24 hold 10 + 9 + 8 + 7 + 6 sessions.
    expect(result[20]).toEqual({ source: otherSourcesLabel(5), count: 40 });
    expect(result[20].source).toBe("other (5 codes)");
    const total = result.reduce((n, r) => n + r.count, 0);
    expect(total).toBe(payloads.length);
  });

  it("does not add an other line at exactly the limit", () => {
    const payloads = Array.from({ length: SOURCE_REPORT_LIMIT }, (_, i) => ({ src: `c${i}` }));
    const result = tallySessionsBySource(payloads);
    expect(result).toHaveLength(SOURCE_REPORT_LIMIT);
    expect(result.some((r) => r.source.startsWith("other"))).toBe(false);
  });

  it("names a single folded code in the singular", () => {
    const payloads = Array.from({ length: SOURCE_REPORT_LIMIT + 1 }, (_, i) => ({ src: `c${i}` }));
    const result = tallySessionsBySource(payloads);
    expect(result[SOURCE_REPORT_LIMIT]).toEqual({ source: "other (1 code)", count: 1 });
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
