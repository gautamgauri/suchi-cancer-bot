import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface ReconciliationMetrics {
  generatedAt: string;
  checklist: {
    settlementsImported: boolean; // placeholder: manual step
    bankCreditsMatched: boolean;
    giftRowsMatched: boolean;
    unmatchedQueueGenerated: boolean;
  };
  reconciliationRate: number; // 0-1, by count of gifts
  reconciliationRateByValue: number; // 0-1, by sum(amount)
  unmatchedCount: number;
  unmatchedValue: number;
  oldestUnmatchedAgeDays: number | null;
  totalGifts: number;
  matchedGifts: number;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(): Promise<ReconciliationMetrics> {
    const now = new Date();
    const gifts = await this.prisma.gift.findMany({
      select: {
        amount: true,
        mappedBankCredit: true,
        dateReceived: true,
      },
    });
    const total = gifts.length;
    const matched = gifts.filter((g) => g.mappedBankCredit);
    const unmatched = gifts.filter((g) => !g.mappedBankCredit);
    const totalValue = gifts.reduce((s, g) => s + Number(g.amount), 0);
    const matchedValue = matched.reduce((s, g) => s + Number(g.amount), 0);
    const unmatchedValue = unmatched.reduce((s, g) => s + Number(g.amount), 0);
    const reconciliationRate = total > 0 ? matched.length / total : 0;
    const reconciliationRateByValue =
      totalValue > 0 ? matchedValue / totalValue : 0;
    const oldestUnmatched = unmatched.length
      ? new Date(
          Math.min(
            ...unmatched.map((g) => new Date(g.dateReceived).getTime()),
          ),
        )
      : null;
    const oldestUnmatchedAgeDays = oldestUnmatched
      ? Math.floor(
          (now.getTime() - oldestUnmatched.getTime()) / (24 * 60 * 60 * 1000),
        )
      : null;

    return {
      generatedAt: now.toISOString(),
      checklist: {
        settlementsImported: true, // manual step; report assumes done when viewing
        bankCreditsMatched: unmatched.length === 0,
        giftRowsMatched: unmatched.length === 0,
        unmatchedQueueGenerated: true,
      },
      reconciliationRate,
      reconciliationRateByValue,
      unmatchedCount: unmatched.length,
      unmatchedValue,
      oldestUnmatchedAgeDays,
      totalGifts: total,
      matchedGifts: matched.length,
    };
  }
}
