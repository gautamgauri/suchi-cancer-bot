import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { IsArray, IsOptional, IsString } from "class-validator";
import { SourceRegistryService } from "./source-registry.service";

class BatchSourcesDto {
  @IsArray()
  @IsString({ each: true })
  docIds!: string[];
}

class SetSnapshotDto {
  @IsString()
  snapshotUrl!: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  title?: string;
}

@Controller("sources")
export class SourceRegistryController {
  constructor(private readonly sourceRegistry: SourceRegistryService) {}

  @Get(":docId")
  async getByDocId(@Param("docId") docId: string) {
    const record = await this.sourceRegistry.getByDocId(docId);
    if (!record) return { source: null };
    return { source: record };
  }

  @Post("batch")
  async getByDocIds(@Body() body: BatchSourcesDto) {
    const docIds = Array.isArray(body.docIds) ? body.docIds : [];
    const sources = await this.sourceRegistry.getByDocIds(docIds);
    return { sources };
  }

  @Patch(":docId/snapshot")
  async setSnapshot(
    @Param("docId") docId: string,
    @Body() body: SetSnapshotDto
  ) {
    const record = await this.sourceRegistry.setSnapshotUrl(docId, body.snapshotUrl);
    if (!record) return { source: null };
    return { source: record };
  }
}
