import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { MiModalityDto } from "../dto";

@Injectable()
export class MiService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<MiModalityDto[]> {
    const list = await this.prisma.frameworkMI.findMany({
      orderBy: { miId: "asc" },
    });
    return list.map((m) => ({
      id: m.id,
      miId: m.miId,
      name: m.name,
      definitionShort: m.definitionShort,
      activitySignals: m.activitySignals,
      assessmentArtifacts: m.assessmentArtifacts,
    }));
  }

  async findByCode(miId: string): Promise<MiModalityDto | null> {
    const m = await this.prisma.frameworkMI.findUnique({
      where: { miId },
    });
    if (!m) return null;
    return {
      id: m.id,
      miId: m.miId,
      name: m.name,
      definitionShort: m.definitionShort,
      activitySignals: m.activitySignals,
      assessmentArtifacts: m.assessmentArtifacts,
    };
  }
}
