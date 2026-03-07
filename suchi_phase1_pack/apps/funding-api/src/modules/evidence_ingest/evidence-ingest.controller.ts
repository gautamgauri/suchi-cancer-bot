import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ExportTokenGuard } from "../admin/export-token.guard";
import { ChunkingService } from "./chunking.service";
import { DownloadService } from "./download.service";
import { EmbeddingService } from "./embedding.service";
import { EvidenceReportsService } from "./evidence-reports.service";
import { ExtractService } from "./extract.service";
import { InventoryService } from "./inventory.service";
import { PipelineService } from "./pipeline.service";
import { RetrievalService, RetrievalPolicyMode } from "./retrieval.service";
import { ReviewQueueService, UpdateReviewDto } from "./review-queue.service";

@Controller("evidence-ingest")
@UseGuards(ExportTokenGuard)
export class EvidenceIngestController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly downloadService: DownloadService,
    private readonly extractService: ExtractService,
    private readonly pipelineService: PipelineService,
    private readonly evidenceReportsService: EvidenceReportsService,
    private readonly reviewQueueService: ReviewQueueService,
    private readonly chunkingService: ChunkingService,
    private readonly embeddingService: EmbeddingService,
    private readonly retrievalService: RetrievalService,
  ) {}

  @Post("inventory")
  async runInventory(
    @Body("sourceFolder") sourceFolder?: string,
  ): Promise<{ added: number; updated: number }> {
    return this.inventoryService.runInventory(sourceFolder ?? "diksha_fundraising");
  }

  @Post("download")
  async runDownload(): Promise<{ success: number; failed: number }> {
    return this.downloadService.downloadPending();
  }

  @Post("extract")
  async runExtract(): Promise<{ googleDocs: { success: number; failed: number; lowText: number }; pdfs: { success: number; failed: number; needsOcr: number } }> {
    const googleDocs = await this.extractService.extractGoogleDocs();
    const pdfs = await this.extractService.extractPdfs();
    return { googleDocs, pdfs };
  }

  @Post("normalize")
  async runNormalize(): Promise<{ updated: number }> {
    return this.extractService.normalizeAll();
  }

  @Post("pipeline")
  async runPipeline(): Promise<{
    duplicates: { groups: number; canonicalSet: number };
    docTypes: { updated: number };
    quality: { scored: number };
    pii: { withPii: number };
  }> {
    return this.pipelineService.runPhase1Pipeline();
  }

  @Get("report")
  async getReport(): Promise<{
    totalDocs: number;
    extractionSuccess: number;
    needsOcr: number;
    tierDistribution: Record<string, number>;
    top50TierA: Array<{ id: string; name: string; driveUrl: string | null; qualityScore: number | null; qualityTier: string | null }>;
    errorSummary: { failed: number; lowText: number };
  }> {
    return this.evidenceReportsService.getPhase1Report();
  }

  @Get("review-queue")
  async getReviewQueue(@Query("status") status?: string) {
    return this.reviewQueueService.getQueue(status);
  }

  @Patch("review-queue/:documentId")
  async updateReview(
    @Param("documentId") documentId: string,
    @Body() body: UpdateReviewDto,
  ) {
    return this.reviewQueueService.upsertForDocument(documentId, body);
  }

  @Post("chunk")
  async runChunking(@Body() body?: { limit?: number; unchunkedOnly?: boolean; afterId?: string }) {
    return this.chunkingService.chunkEligibleDocuments({
      limit: body?.limit,
      unchunkedOnly: body?.unchunkedOnly,
      afterId: body?.afterId,
    });
  }

  @Post("embed")
  async runEmbedding(): Promise<{
    embedded: number;
    failed: number;
    durationMs: number;
    tokenCountProxy: number;
  }> {
    return this.embeddingService.embedPendingChunks();
  }

  @Post("retrieve")
  async retrieve(
    @Body("query") query: string,
    @Body("mode") mode?: RetrievalPolicyMode,
    @Body("limit") limit?: number,
    @Body("publicSafeOnly") publicSafeOnly?: boolean,
    @Body("visibilityScope") visibilityScope?: string,
    @Body("orgId") orgId?: string,
  ) {
    return this.retrievalService.retrieve(query || "", {
      mode,
      limit,
      publicSafeOnly,
      visibilityScope,
      orgId,
    });
  }

  @Post("eval")
  async runEval(
    @Body("mode") mode?: RetrievalPolicyMode,
    @Body("limit") limit?: number,
    @Body("queries") queries?: string[],
  ) {
    return this.retrievalService.runEval({ mode, limit, queries });
  }
}
