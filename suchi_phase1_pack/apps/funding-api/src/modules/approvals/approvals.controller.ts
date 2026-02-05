import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApprovalsService } from "./approvals.service";
import { CreateArtifactDto, CreateVersionDto, SubmitApprovalDto } from "./approvals.dto";

@Controller("approvals")
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post("artifacts")
  async createArtifact(@Body() body: CreateArtifactDto) {
    return this.approvalsService.createArtifact(body.pipelineEntryId, body.type);
  }

  @Post("artifacts/:artifactId/versions")
  async createVersion(@Param("artifactId") artifactId: string, @Body() body: CreateVersionDto) {
    return this.approvalsService.createVersion(artifactId, body.content, body.createdBy);
  }

  @Post("versions/:versionId/approve")
  async submitApproval(
    @Param("versionId") versionId: string,
    @Body() body: SubmitApprovalDto
  ) {
    return this.approvalsService.submitApproval(
      versionId,
      body.status,
      body.decidedBy,
      body.comment
    );
  }

  @Get("entries/:pipelineEntryId/pending")
  async getPendingForEntry(@Param("pipelineEntryId") pipelineEntryId: string) {
    const pending = await this.approvalsService.getPendingForEntry(pipelineEntryId);
    return { pending };
  }

  @Get("entries/:pipelineEntryId/artifacts")
  async getArtifactsForEntry(@Param("pipelineEntryId") pipelineEntryId: string) {
    const artifacts = await this.approvalsService.getArtifactsForEntry(pipelineEntryId);
    return { artifacts };
  }

  @Get("artifacts/:artifactId/versions")
  async getVersionsForArtifact(@Param("artifactId") artifactId: string) {
    const versions = await this.approvalsService.getVersionsForArtifact(artifactId);
    return { versions };
  }
}
