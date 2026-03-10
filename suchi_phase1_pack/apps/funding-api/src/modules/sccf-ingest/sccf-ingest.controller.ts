import { Controller, Get, Post, Query, Body, Logger } from "@nestjs/common";
import { SccfIngestService } from "./sccf-ingest.service";

@Controller("sccf-ingest")
export class SccfIngestController {
  private readonly logger = new Logger(SccfIngestController.name);

  constructor(private readonly sccfIngest: SccfIngestService) {}

  /** POST /v1/sccf-ingest/index — full scan (Drive + Gmail) */
  @Post("index")
  async indexAll() {
    this.logger.log("Triggering full SCCF index (Drive + Gmail)");
    return this.sccfIngest.indexAll();
  }

  /** POST /v1/sccf-ingest/index/drive — Drive only */
  @Post("index/drive")
  async indexDrive() {
    this.logger.log("Triggering SCCF Drive index");
    return this.sccfIngest.indexDrive();
  }

  /** POST /v1/sccf-ingest/index/gmail — Gmail only */
  @Post("index/gmail")
  async indexGmail() {
    this.logger.log("Triggering SCCF Gmail index");
    return this.sccfIngest.indexGmail();
  }

  /** POST /v1/sccf-ingest/categorize — Phase 2: LLM categorization (default batch 100) */
  @Post("categorize")
  async categorize(@Body() body?: { limit?: number }) {
    this.logger.log(`Triggering SCCF document categorization (limit: ${body?.limit ?? 100})`);
    return this.sccfIngest.categorizeDocuments(body);
  }

  /** POST /v1/sccf-ingest/ingest — Phase 3: download + extract + create EvidenceDocument (default batch 50) */
  @Post("ingest")
  async ingest(@Body() body?: { category?: string; limit?: number }) {
    this.logger.log(`Triggering SCCF ingestion (limit: ${body?.limit ?? 50}${body?.category ? `, category: ${body.category}` : ""})`);
    return this.sccfIngest.ingestToEvidenceLibrary(body);
  }

  /** POST /v1/sccf-ingest/ingest-full — Phase 2+3 + chunk + embed all-in-one */
  @Post("ingest-full")
  async ingestFull(@Body() body?: { category?: string }) {
    this.logger.log("Triggering full SCCF pipeline (categorize + ingest + chunk + embed)");
    return this.sccfIngest.ingestFull(body);
  }

  /** GET /v1/sccf-ingest/index — paginated list of all SccfDocuments */
  @Get("index")
  async list(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.sccfIngest.listDocuments({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  /** GET /v1/sccf-ingest/index/summary — counts by sourceType, mimeType, ingestStatus */
  @Get("index/summary")
  async summary() {
    return this.sccfIngest.getSummary();
  }
}
