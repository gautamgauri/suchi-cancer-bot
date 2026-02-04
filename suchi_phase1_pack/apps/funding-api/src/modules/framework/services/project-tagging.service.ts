import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { TagProjectDto, ProjectTagsDto } from "../dto";

@Injectable()
export class ProjectTaggingService {
  constructor(private readonly prisma: PrismaService) {}

  async tagProject(
    pipelineEntryId: string,
    dto: TagProjectDto,
  ): Promise<ProjectTagsDto> {
    const entry = await this.prisma.pipelineEntry.findUnique({
      where: { id: pipelineEntryId },
    });
    if (!entry) throw new NotFoundException(`Pipeline entry ${pipelineEntryId} not found`);

    await this.prisma.projectCapability.deleteMany({
      where: { pipelineEntryId },
    });

    const capabilities = await this.prisma.frameworkCapability.findMany({
      where: { capabilityId: { in: dto.capabilityIds } },
    });
    const capById = new Map(capabilities.map((c) => [c.capabilityId, c]));

    const isPrimary = dto.isPrimary ?? dto.capabilityIds.map(() => false);
    const strength = dto.strength ?? dto.capabilityIds.map(() => null as number | null);
    const isApplicable = dto.isApplicable ?? dto.capabilityIds.map(() => true);

    for (let i = 0; i < dto.capabilityIds.length; i++) {
      const cap = capById.get(dto.capabilityIds[i]);
      if (!cap) continue;
      await this.prisma.projectCapability.create({
        data: {
          pipelineEntryId,
          capabilityId: cap.id,
          isPrimary: isPrimary[i] ?? false,
          strength: strength[i] ?? null,
          isApplicable: isApplicable[i] ?? true,
        },
      });
    }

    return this.getProjectTags(pipelineEntryId);
  }

  async getProjectTags(pipelineEntryId: string): Promise<ProjectTagsDto> {
    const links = await this.prisma.projectCapability.findMany({
      where: { pipelineEntryId },
      include: { capability: true },
    });
    return {
      capabilities: links.map((l) => ({
        capabilityId: l.capability.capabilityId,
        name: l.capability.name,
        isPrimary: l.isPrimary,
        strength: l.strength,
        isApplicable: l.isApplicable,
      })),
    };
  }
}
