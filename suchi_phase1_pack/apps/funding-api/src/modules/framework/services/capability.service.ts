import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CapabilityDto } from "../dto";

@Injectable()
export class CapabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CapabilityDto[]> {
    const list = await this.prisma.frameworkCapability.findMany({
      orderBy: { capabilityId: "asc" },
    });
    return list.map((c) => ({
      id: c.id,
      capabilityId: c.capabilityId,
      name: c.name,
      definitionShort: c.definitionShort,
      definitionLong: c.definitionLong,
      subdimensions: c.subdimensions,
      biharContextExamples: c.biharContextExamples,
      measurementIdeas: c.measurementIdeas,
      ethicsRisks: c.ethicsRisks,
    }));
  }

  async findByCode(capabilityId: string): Promise<CapabilityDto | null> {
    const c = await this.prisma.frameworkCapability.findUnique({
      where: { capabilityId },
    });
    if (!c) return null;
    return {
      id: c.id,
      capabilityId: c.capabilityId,
      name: c.name,
      definitionShort: c.definitionShort,
      definitionLong: c.definitionLong,
      subdimensions: c.subdimensions,
      biharContextExamples: c.biharContextExamples,
      measurementIdeas: c.measurementIdeas,
      ethicsRisks: c.ethicsRisks,
    };
  }
}
