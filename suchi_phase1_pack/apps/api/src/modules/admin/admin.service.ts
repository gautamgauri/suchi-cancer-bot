import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listConversations(opts: { from?: string; to?: string; filter?: string }) {
    const from = parseDate(opts.from);
    const to = parseDate(opts.to);
    const filter = opts.filter ?? "";

    const sessions = await this.prisma.session.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { messages: { orderBy: { createdAt: "asc" }, take: 50 }, feedback: true, safetyEvents: true }
    });

    const filtered = sessions.filter((s) => {
      if (filter === "thumbs_down") return s.feedback.some((f) => f.rating === "down");
      if (filter === "safety") return s.safetyEvents.length > 0;
      return true;
    });

    return filtered.map((s) => ({
      sessionId: s.id,
      createdAt: s.createdAt,
      channel: s.channel,
      locale: s.locale,
      userType: s.userType,
      feedback: s.feedback,
      safetyEvents: s.safetyEvents,
      messages: s.messages
    }));
  }

  async metrics(opts: { from?: string; to?: string }) {
    const from = parseDate(opts.from);
    const to = parseDate(opts.to);

    const [sessions, up, down, safety] = await Promise.all([
      this.prisma.session.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.feedback.count({ where: { createdAt: { gte: from, lte: to }, rating: "up" } }),
      this.prisma.feedback.count({ where: { createdAt: { gte: from, lte: to }, rating: "down" } }),
      this.prisma.safetyEvent.count({ where: { createdAt: { gte: from, lte: to } } })
    ]);

    return { sessions, feedback: { up, down }, safetyEvents: safety };
  }
}
