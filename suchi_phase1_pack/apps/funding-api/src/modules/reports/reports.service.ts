import { Injectable } from "@nestjs/common";
import { PipelineService } from "../pipeline/pipeline.service";

export interface DigestOverdueItem {
  id: string;
  orgName: string;
  nextAction?: string;
  nextActionDate: string;
  owner?: string;
}

export interface DigestReport {
  generatedAt: string;
  pipeline: {
    total: number;
    byStage: Record<string, number>;
  };
  overdue: {
    count: number;
    entries: DigestOverdueItem[];
  };
}

type EntryWithMeta = Awaited<ReturnType<PipelineService["getEntries"]>>[number] & {
  id?: string;
  stage?: string;
  nextAction?: string;
  nextActionDate?: string;
  assignedTo?: string;
};

@Injectable()
export class ReportsService {
  constructor(private readonly pipelineService: PipelineService) {}

  async getDigest(): Promise<DigestReport> {
    const entries = (await this.pipelineService.getEntries()) as EntryWithMeta[];
    const now = new Date();

    const byStage: Record<string, number> = {};
    const overdueEntries: DigestOverdueItem[] = [];

    for (const e of entries) {
      const stage = e.stage ?? "unknown";
      byStage[stage] = (byStage[stage] ?? 0) + 1;

      const nextActionDate = e.nextActionDate;
      if (nextActionDate) {
        const d = new Date(nextActionDate);
        if (d < now) {
          overdueEntries.push({
            id: e.id ?? "",
            orgName: e.orgName,
            nextAction: e.nextAction,
            nextActionDate,
            owner: e.assignedTo,
          });
        }
      }
    }

    return {
      generatedAt: now.toISOString(),
      pipeline: {
        total: entries.length,
        byStage,
      },
      overdue: {
        count: overdueEntries.length,
        entries: overdueEntries.sort(
          (a, b) => new Date(a.nextActionDate).getTime() - new Date(b.nextActionDate).getTime()
        ),
      },
    };
  }
}
