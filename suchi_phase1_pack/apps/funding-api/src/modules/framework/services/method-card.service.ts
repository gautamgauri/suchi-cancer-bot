import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  MethodCardDto,
  CreateMethodCardDto,
  UpdateMethodCardDto,
  MethodCardQueryDto,
} from "../dto";

function toMethodCardDto(row: {
  id: string;
  methodId: string;
  title: string;
  intent: string;
  steps: string[];
  whenToUse: string | null;
  whenNotToUse: string | null;
  ageBand: string | null;
  settingTags: string[];
  assessmentArtifacts: string[];
  sourceUrl: string | null;
  licenseFlag: string;
  qualityScore: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  methodCardMIs: Array<{ isPrimary: boolean; mi: { miId: string } }>;
  methodCardCapabilities: Array<{ capability: { capabilityId: string } }>;
}): MethodCardDto {
  const primary = row.methodCardMIs.filter((x) => x.isPrimary).map((x) => x.mi.miId);
  const secondary = row.methodCardMIs.filter((x) => !x.isPrimary).map((x) => x.mi.miId);
  return {
    id: row.id,
    methodId: row.methodId,
    title: row.title,
    intent: row.intent,
    steps: row.steps,
    whenToUse: row.whenToUse,
    whenNotToUse: row.whenNotToUse,
    ageBand: row.ageBand,
    settingTags: row.settingTags,
    assessmentArtifacts: row.assessmentArtifacts,
    sourceUrl: row.sourceUrl,
    licenseFlag: row.licenseFlag,
    qualityScore: row.qualityScore,
    status: row.status,
    miTagsPrimary: primary,
    miTagsSecondary: secondary,
    capabilityLinks: row.methodCardCapabilities.map((c) => c.capability.capabilityId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class MethodCardService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMethodCardDto): Promise<MethodCardDto> {
    const card = await this.prisma.frameworkMethodCard.create({
      data: {
        methodId: dto.methodId,
        title: dto.title,
        intent: dto.intent,
        steps: dto.steps ?? [],
        whenToUse: dto.whenToUse,
        whenNotToUse: dto.whenNotToUse,
        ageBand: dto.ageBand,
        settingTags: dto.settingTags ?? [],
        assessmentArtifacts: dto.assessmentArtifacts ?? [],
        sourceDocId: dto.sourceDocId,
        sourceUrl: dto.sourceUrl,
        licenseFlag: dto.licenseFlag ?? "UNKNOWN",
      },
    });
    const seenMi = new Set<string>();
    for (const miId of dto.miTagsPrimary ?? []) {
      const fid = await this.resolveMiId(miId);
      if (!seenMi.has(fid)) {
        seenMi.add(fid);
        await this.prisma.methodCardMI.create({
          data: { methodCardId: card.id, miId: fid, isPrimary: true },
        });
      }
    }
    for (const miId of dto.miTagsSecondary ?? []) {
      const fid = await this.resolveMiId(miId);
      if (!seenMi.has(fid)) {
        seenMi.add(fid);
        await this.prisma.methodCardMI.create({
          data: { methodCardId: card.id, miId: fid, isPrimary: false },
        });
      }
    }
    for (const capabilityId of dto.capabilityLinks ?? []) {
      const cid = await this.resolveCapabilityId(capabilityId);
      await this.prisma.methodCardCapability.create({
        data: { methodCardId: card.id, capabilityId: cid },
      });
    }
    const full = await this.prisma.frameworkMethodCard.findUnique({
      where: { id: card.id },
      include: {
        methodCardMIs: { include: { mi: true } },
        methodCardCapabilities: { include: { capability: true } },
      },
    });
    return toMethodCardDto(full as never);
  }

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

  async findById(id: string): Promise<MethodCardDto | null> {
    const card = await this.prisma.frameworkMethodCard.findUnique({
      where: { id },
      include: {
        methodCardMIs: { include: { mi: true } },
        methodCardCapabilities: { include: { capability: true } },
      },
    });
    return card ? toMethodCardDto(card as never) : null;
  }

  async findByMethodId(methodId: string): Promise<MethodCardDto | null> {
    const card = await this.prisma.frameworkMethodCard.findUnique({
      where: { methodId },
      include: {
        methodCardMIs: { include: { mi: true } },
        methodCardCapabilities: { include: { capability: true } },
      },
    });
    return card ? toMethodCardDto(card as never) : null;
  }

  async list(query: MethodCardQueryDto): Promise<MethodCardDto[]> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.capabilities?.length) {
      where.methodCardCapabilities = {
        some: {
          capability: { capabilityId: { in: query.capabilities } },
        },
      };
    }
    if (query.miModalities?.length) {
      where.methodCardMIs = {
        some: {
          mi: { miId: { in: query.miModalities } },
        },
      };
    }
    if (query.ageBand) where.ageBand = query.ageBand;
    if (query.setting) where.settingTags = { has: query.setting };

    const cards = await this.prisma.frameworkMethodCard.findMany({
      where,
      include: {
        methodCardMIs: { include: { mi: true } },
        methodCardCapabilities: { include: { capability: true } },
      },
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
      orderBy: { createdAt: "desc" },
    });
    return cards.map((c) => toMethodCardDto(c as never));
  }

  async update(id: string, dto: UpdateMethodCardDto): Promise<MethodCardDto> {
    const existing = await this.prisma.frameworkMethodCard.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Method card ${id} not found`);

    if (dto.miTagsPrimary !== undefined || dto.miTagsSecondary !== undefined) {
      await this.prisma.methodCardMI.deleteMany({ where: { methodCardId: id } });
      const miIds = [
        ...(dto.miTagsPrimary ?? []).map((miId) => ({ miId, isPrimary: true })),
        ...(dto.miTagsSecondary ?? []).map((miId) => ({ miId, isPrimary: false })),
      ];
      for (const { miId, isPrimary } of miIds) {
        const fid = await this.resolveMiId(miId);
        await this.prisma.methodCardMI.create({
          data: { methodCardId: id, miId: fid, isPrimary },
        });
      }
    }
    if (dto.capabilityLinks !== undefined) {
      await this.prisma.methodCardCapability.deleteMany({ where: { methodCardId: id } });
      for (const capabilityId of dto.capabilityLinks) {
        const cid = await this.resolveCapabilityId(capabilityId);
        await this.prisma.methodCardCapability.create({
          data: { methodCardId: id, capabilityId: cid },
        });
      }
    }

    const { miTagsPrimary, miTagsSecondary, capabilityLinks, ...rest } = dto;
    const card = await this.prisma.frameworkMethodCard.update({
      where: { id },
      data: rest as Record<string, unknown>,
      include: {
        methodCardMIs: { include: { mi: true } },
        methodCardCapabilities: { include: { capability: true } },
      },
    });
    return toMethodCardDto(card as never);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.frameworkMethodCard.delete({ where: { id } });
  }
}
