import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  PatternCardDto,
  CreatePatternCardDto,
  UpdatePatternCardDto,
  PatternCardQueryDto,
} from "../dto";

function toPatternCardDto(row: {
  id: string;
  patternId: string;
  title: string;
  durationMins: number | null;
  materials: string[];
  facilitatorScript: string[];
  adaptations: string[];
  assessmentArtifacts: string[];
  sourceUrl: string | null;
  evidenceLevel: string;
  qualityScore: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  patternCardMIs: Array<{ isPrimary: boolean; mi: { miId: string } }>;
  patternCardCapabilities: Array<{ isPrimary: boolean; capability: { capabilityId: string } }>;
}): PatternCardDto {
  const primaryMi = row.patternCardMIs.filter((x) => x.isPrimary).map((x) => x.mi.miId);
  const secondaryMi = row.patternCardMIs.filter((x) => !x.isPrimary).map((x) => x.mi.miId);
  const primaryCap = row.patternCardCapabilities.filter((x) => x.isPrimary).map((x) => x.capability.capabilityId);
  const secondaryCap = row.patternCardCapabilities.filter((x) => !x.isPrimary).map((x) => x.capability.capabilityId);
  return {
    id: row.id,
    patternId: row.patternId,
    title: row.title,
    durationMins: row.durationMins,
    materials: row.materials,
    facilitatorScript: row.facilitatorScript,
    adaptations: row.adaptations,
    assessmentArtifacts: row.assessmentArtifacts,
    sourceUrl: row.sourceUrl,
    evidenceLevel: row.evidenceLevel,
    qualityScore: row.qualityScore,
    status: row.status,
    miTagsPrimary: primaryMi,
    miTagsSecondary: secondaryMi,
    capabilitiesPrimary: primaryCap,
    capabilitiesSecondary: secondaryCap,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PatternCardService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveMiId(miIdOrCode: string): Promise<string> {
    if (miIdOrCode.startsWith("MI")) {
      const m = await this.prisma.frameworkMI.findUnique({ where: { miId: miIdOrCode } });
      if (m) return m.id;
    }
    const m = await this.prisma.frameworkMI.findFirst({ where: { id: miIdOrCode } });
    if (m) return m.id;
    throw new Error(`MI not found: ${miIdOrCode}`);
  }

  private async resolveCapabilityId(capabilityIdOrCode: string): Promise<string> {
    if (capabilityIdOrCode.startsWith("C")) {
      const c = await this.prisma.frameworkCapability.findUnique({
        where: { capabilityId: capabilityIdOrCode },
      });
      if (c) return c.id;
    }
    const c = await this.prisma.frameworkCapability.findFirst({
      where: { id: capabilityIdOrCode },
    });
    if (c) return c.id;
    throw new Error(`Capability not found: ${capabilityIdOrCode}`);
  }

  async create(dto: CreatePatternCardDto): Promise<PatternCardDto> {
    const card = await this.prisma.frameworkPatternCard.create({
      data: {
        patternId: dto.patternId,
        title: dto.title,
        durationMins: dto.durationMins,
        materials: dto.materials ?? [],
        facilitatorScript: dto.facilitatorScript ?? [],
        adaptations: dto.adaptations ?? [],
        assessmentArtifacts: dto.assessmentArtifacts ?? [],
        sourceDocId: dto.sourceDocId,
        sourceUrl: dto.sourceUrl,
        evidenceLevel: dto.evidenceLevel ?? "ANECDOTAL",
      },
    });
    const seenMi = new Set<string>();
    for (const miId of dto.miTagsPrimary ?? []) {
      const fid = await this.resolveMiId(miId);
      if (!seenMi.has(fid)) {
        seenMi.add(fid);
        await this.prisma.patternCardMI.create({
          data: { patternCardId: card.id, miId: fid, isPrimary: true },
        });
      }
    }
    for (const miId of dto.miTagsSecondary ?? []) {
      const fid = await this.resolveMiId(miId);
      if (!seenMi.has(fid)) {
        seenMi.add(fid);
        await this.prisma.patternCardMI.create({
          data: { patternCardId: card.id, miId: fid, isPrimary: false },
        });
      }
    }
    for (const capabilityId of dto.capabilitiesPrimary ?? []) {
      const cid = await this.resolveCapabilityId(capabilityId);
      await this.prisma.patternCardCapability.create({
        data: { patternCardId: card.id, capabilityId: cid, isPrimary: true },
      });
    }
    for (const capabilityId of dto.capabilitiesSecondary ?? []) {
      const cid = await this.resolveCapabilityId(capabilityId);
      await this.prisma.patternCardCapability.create({
        data: { patternCardId: card.id, capabilityId: cid, isPrimary: false },
      });
    }
    const full = await this.prisma.frameworkPatternCard.findUnique({
      where: { id: card.id },
      include: {
        patternCardMIs: { include: { mi: true } },
        patternCardCapabilities: { include: { capability: true } },
      },
    });
    return toPatternCardDto(full as never);
  }

  async findById(id: string): Promise<PatternCardDto | null> {
    const card = await this.prisma.frameworkPatternCard.findUnique({
      where: { id },
      include: {
        patternCardMIs: { include: { mi: true } },
        patternCardCapabilities: { include: { capability: true } },
      },
    });
    return card ? toPatternCardDto(card as never) : null;
  }

  async list(query: PatternCardQueryDto): Promise<PatternCardDto[]> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.capabilities?.length) {
      where.patternCardCapabilities = {
        some: { capability: { capabilityId: { in: query.capabilities } } },
      };
    }
    if (query.miModalities?.length) {
      where.patternCardMIs = {
        some: { mi: { miId: { in: query.miModalities } } },
      };
    }

    const cards = await this.prisma.frameworkPatternCard.findMany({
      where,
      include: {
        patternCardMIs: { include: { mi: true } },
        patternCardCapabilities: { include: { capability: true } },
      },
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
      orderBy: { createdAt: "desc" },
    });
    return cards.map((c) => toPatternCardDto(c as never));
  }

  async update(id: string, dto: UpdatePatternCardDto): Promise<PatternCardDto> {
    const existing = await this.prisma.frameworkPatternCard.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Pattern card ${id} not found`);

    if (dto.miTagsPrimary !== undefined || dto.miTagsSecondary !== undefined) {
      await this.prisma.patternCardMI.deleteMany({ where: { patternCardId: id } });
      for (const miId of dto.miTagsPrimary ?? []) {
        const fid = await this.resolveMiId(miId);
        await this.prisma.patternCardMI.create({
          data: { patternCardId: id, miId: fid, isPrimary: true },
        });
      }
      for (const miId of dto.miTagsSecondary ?? []) {
        const fid = await this.resolveMiId(miId);
        await this.prisma.patternCardMI.create({
          data: { patternCardId: id, miId: fid, isPrimary: false },
        });
      }
    }
    if (dto.capabilitiesPrimary !== undefined || dto.capabilitiesSecondary !== undefined) {
      await this.prisma.patternCardCapability.deleteMany({ where: { patternCardId: id } });
      for (const capabilityId of dto.capabilitiesPrimary ?? []) {
        const cid = await this.resolveCapabilityId(capabilityId);
        await this.prisma.patternCardCapability.create({
          data: { patternCardId: id, capabilityId: cid, isPrimary: true },
        });
      }
      for (const capabilityId of dto.capabilitiesSecondary ?? []) {
        const cid = await this.resolveCapabilityId(capabilityId);
        await this.prisma.patternCardCapability.create({
          data: { patternCardId: id, capabilityId: cid, isPrimary: false },
        });
      }
    }

    const { miTagsPrimary, miTagsSecondary, capabilitiesPrimary, capabilitiesSecondary, ...rest } = dto;
    const card = await this.prisma.frameworkPatternCard.update({
      where: { id },
      data: rest as Record<string, unknown>,
      include: {
        patternCardMIs: { include: { mi: true } },
        patternCardCapabilities: { include: { capability: true } },
      },
    });
    return toPatternCardDto(card as never);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.frameworkPatternCard.delete({ where: { id } });
  }
}
