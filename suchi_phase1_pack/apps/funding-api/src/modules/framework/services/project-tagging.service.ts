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

    const capabilityIds = dto.tags.map((t) => t.capabilityId);
    const capabilities = await this.prisma.frameworkCapability.findMany({
      where: { capabilityId: { in: capabilityIds } },
    });
    const capById = new Map(capabilities.map((c) => [c.capabilityId, c]));

    for (const tag of dto.tags) {
      const cap = capById.get(tag.capabilityId);
      if (!cap) continue;
      await this.prisma.projectCapability.create({
        data: {
          pipelineEntryId,
          capabilityId: cap.id,
          isPrimary: tag.isPrimary,
          strength: tag.strength,
          isApplicable: tag.isApplicable,
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
