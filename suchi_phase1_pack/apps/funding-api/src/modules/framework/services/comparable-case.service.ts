import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  ComparableCaseDto,
  CreateComparableCaseDto,
  UpdateComparableCaseDto,
  ComparableCaseQueryDto,
} from "../dto";

function toComparableCaseDto(row: {
  id: string;
  caseId: string;
  programName: string;
  orgName: string;
  geography: string;
  targetGroup: string;
  deliveryModelTags: string[];
  outcomesSummary: string;
  indicatorsUsed: string[];
  costNotes: string | null;
  programConstraints: string | null;
  contextConstraints: string | null;
  transferabilityBihar: string | null;
  sourceUrl: string | null;
  confidenceScore: number;
  qualityScore: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  comparableCaseCapabilities: Array<{ isPrimary: boolean; capability: { capabilityId: string } }>;
}): ComparableCaseDto {
  const primary = row.comparableCaseCapabilities.filter((x) => x.isPrimary).map((x) => x.capability.capabilityId);
  const secondary = row.comparableCaseCapabilities.filter((x) => !x.isPrimary).map((x) => x.capability.capabilityId);
  return {
    id: row.id,
    caseId: row.caseId,
    programName: row.programName,
    orgName: row.orgName,
    geography: row.geography,
    targetGroup: row.targetGroup,
    deliveryModelTags: row.deliveryModelTags,
    outcomesSummary: row.outcomesSummary,
    indicatorsUsed: row.indicatorsUsed,
    costNotes: row.costNotes,
    programConstraints: row.programConstraints,
    contextConstraints: row.contextConstraints,
    transferabilityBihar: row.transferabilityBihar,
    sourceUrl: row.sourceUrl,
    confidenceScore: row.confidenceScore,
    qualityScore: row.qualityScore,
    status: row.status,
    capabilitiesPrimary: primary,
    capabilitiesSecondary: secondary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class ComparableCaseService {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(dto: CreateComparableCaseDto): Promise<ComparableCaseDto> {
    const row = await this.prisma.frameworkComparableCase.create({
      data: {
        caseId: dto.caseId,
        programName: dto.programName,
        orgName: dto.orgName,
        geography: dto.geography,
        targetGroup: dto.targetGroup,
        deliveryModelTags: dto.deliveryModelTags ?? [],
        outcomesSummary: dto.outcomesSummary,
        indicatorsUsed: dto.indicatorsUsed ?? [],
        costNotes: dto.costNotes,
        programConstraints: dto.programConstraints,
        contextConstraints: dto.contextConstraints,
        transferabilityBihar: dto.transferabilityBihar,
        sourceDocId: dto.sourceDocId,
        sourceUrl: dto.sourceUrl,
        confidenceScore: dto.confidenceScore ?? 3,
      },
    });
    for (const capabilityId of dto.capabilitiesPrimary ?? []) {
      const cid = await this.resolveCapabilityId(capabilityId);
      await this.prisma.comparableCaseCapability.create({
        data: { caseId: row.id, capabilityId: cid, isPrimary: true },
      });
    }
    for (const capabilityId of dto.capabilitiesSecondary ?? []) {
      const cid = await this.resolveCapabilityId(capabilityId);
      await this.prisma.comparableCaseCapability.create({
        data: { caseId: row.id, capabilityId: cid, isPrimary: false },
      });
    }
    const full = await this.prisma.frameworkComparableCase.findUnique({
      where: { id: row.id },
      include: { comparableCaseCapabilities: { include: { capability: true } } },
    });
    return toComparableCaseDto(full as never);
  }

  async findById(id: string): Promise<ComparableCaseDto | null> {
    const row = await this.prisma.frameworkComparableCase.findUnique({
      where: { id },
      include: { comparableCaseCapabilities: { include: { capability: true } } },
    });
    return row ? toComparableCaseDto(row as never) : null;
  }

  async list(query: ComparableCaseQueryDto): Promise<ComparableCaseDto[]> {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.targetGroup) where.targetGroup = query.targetGroup;
    if (query.geography) where.geography = { contains: query.geography, mode: "insensitive" };
    if (query.capabilities?.length) {
      where.comparableCaseCapabilities = {
        some: { capability: { capabilityId: { in: query.capabilities } } },
      };
    }

    const rows = await this.prisma.frameworkComparableCase.findMany({
      where,
      include: { comparableCaseCapabilities: { include: { capability: true } } },
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => toComparableCaseDto(r as never));
  }

  async update(id: string, dto: UpdateComparableCaseDto): Promise<ComparableCaseDto> {
    const existing = await this.prisma.frameworkComparableCase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Comparable case ${id} not found`);

    if (dto.capabilitiesPrimary !== undefined || dto.capabilitiesSecondary !== undefined) {
      await this.prisma.comparableCaseCapability.deleteMany({ where: { caseId: id } });
      for (const capabilityId of dto.capabilitiesPrimary ?? []) {
        const cid = await this.resolveCapabilityId(capabilityId);
        await this.prisma.comparableCaseCapability.create({
          data: { caseId: id, capabilityId: cid, isPrimary: true },
        });
      }
      for (const capabilityId of dto.capabilitiesSecondary ?? []) {
        const cid = await this.resolveCapabilityId(capabilityId);
        await this.prisma.comparableCaseCapability.create({
          data: { caseId: id, capabilityId: cid, isPrimary: false },
        });
      }
    }

    const { capabilitiesPrimary, capabilitiesSecondary, ...rest } = dto;
    const row = await this.prisma.frameworkComparableCase.update({
      where: { id },
      data: rest as Record<string, unknown>,
      include: { comparableCaseCapabilities: { include: { capability: true } } },
    });
    return toComparableCaseDto(row as never);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.frameworkComparableCase.delete({ where: { id } });
  }
}
