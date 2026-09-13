import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { BasicAuthGuard } from "../../common/guards/basic-auth.guard";
import { YoutubeService } from "./youtube.service";
import { KbService, STAGED_MANIFEST_FILENAME } from "./kb.service";

interface IngestRequest {
  videoIds?: string[];
  videoUrls?: string[];
  channelUrl?: string;
  language?: string; // Optional: 'en', 'hi', etc.
}

/**
 * Explicit opt-in flag for the ingest route.
 *
 * ISSUE #91 — the endpoint is deployed and reachable on production. Even with
 * the empty-transcript and ephemeral-write defects fixed, writing KB content is
 * an offline, reviewable, local operation: transcripts have to land in a repo
 * checkout and go through a pull request, because they are uncorrected machine
 * captions of medical conversation. Admin credentials alone must not be enough
 * to start writing KB documents, so the route is off unless someone sets this
 * to exactly "true". It is set to `false` in both Cloud Build pipelines.
 */
const INGEST_FLAG = "YOUTUBE_INGEST_ENABLED";

@UseGuards(BasicAuthGuard)
@Controller("admin/youtube")
export class YoutubeController {
  private readonly logger = new Logger(YoutubeController.name);

  private assertIngestEnabled(): void {
    if ((process.env[INGEST_FLAG] ?? "false").toLowerCase() !== "true") {
      throw new ForbiddenException(
        `YouTube transcript ingestion is disabled. This endpoint writes knowledge-base documents from ` +
          `uncorrected machine captions; that has to happen in a repo checkout and go through review, not ` +
          `on a running server. Set ${INGEST_FLAG}=true only in a local checkout, or use ` +
          `\`npx ts-node src/scripts/youtube-transcript-draft.ts\` instead.`,
      );
    }
  }

  constructor(
    private readonly youtubeService: YoutubeService,
    private readonly kbService: KbService
  ) {}

  /**
   * Ingest YouTube transcripts into knowledge base
   * POST /admin/youtube/ingest
   *
   * Body:
   * {
   *   "videoIds": ["VIDEO_ID_1", "VIDEO_ID_2"],
   *   "videoUrls": ["https://www.youtube.com/watch?v=VIDEO_ID"],
   *   "channelUrl": "https://www.youtube.com/@OncoTalks"
   * }
   */
  @Post("ingest")
  async ingestTranscripts(@Body() body: IngestRequest) {
    try {
      this.assertIngestEnabled();
      this.logger.log("Starting YouTube transcript ingestion");

      // ISSUE #91 (b): on Cloud Run the old code wrote KB markdown and manifest
      // edits to container scratch, which is discarded on restart. KB content is
      // reviewed material — it has to land in a repo checkout and go through a
      // PR. Refuse the request rather than pretend it worked.
      if (!this.kbService.isKbRootWritable()) {
        throw new BadRequestException(
          "No writable KB checkout is configured (KB_ROOT). YouTube transcripts must be generated in a " +
            "repo checkout, reviewed, and committed via a pull request — not written to container storage, " +
            "where they are discarded on restart and never reviewed. " +
            "Run the transcript tooling locally instead.",
        );
      }

      // Collect all video IDs
      const videoIds: string[] = [];

      // Add from direct video IDs
      if (body.videoIds && body.videoIds.length > 0) {
        videoIds.push(...body.videoIds);
      }

      // Add from video URLs
      if (body.videoUrls && body.videoUrls.length > 0) {
        for (const url of body.videoUrls) {
          const videoId = this.youtubeService.extractVideoId(url);
          if (videoId) {
            videoIds.push(videoId);
          } else {
            this.logger.warn(`Could not extract video ID from URL: ${url}`);
          }
        }
      }

      // Add from channel (future enhancement)
      if (body.channelUrl) {
        this.logger.warn("Channel scraping not yet implemented. Please provide video IDs directly.");
      }

      if (videoIds.length === 0) {
        return {
          success: false,
          message: "No video IDs provided",
          processed: 0
        };
      }

      this.logger.log(`Processing ${videoIds.length} videos`);

      // Fetch transcripts (with optional language preference)
      const transcripts = [];
      const fetchFailures: Array<{ videoId: string; reason: string }> = [];
      for (const videoId of videoIds) {
        try {
          const transcript = await this.youtubeService.getVideoTranscript(videoId, body.language);
          transcripts.push(transcript);

          // Rate limiting: wait 1 second between requests
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          this.logger.error(`Failed to process ${videoId}: ${error.message}`);
          fetchFailures.push({ videoId, reason: error.message });
        }
      }

      this.logger.log(`Successfully fetched ${transcripts.length} transcripts`);

      // Save to knowledge base. The STAGING manifest, explicitly — never
      // kb/manifest.json, which `npm run kb:ingest` reads unconditionally.
      const stagedManifest = this.kbService.stagedManifestPath();
      const result = await this.kbService.batchSaveToKb(transcripts, stagedManifest);

      this.logger.log(`Ingestion complete: ${result.saved} saved, ${result.errors} errors`);

      return {
        success: true,
        message:
          `Wrote ${result.saved} transcript draft(s) to the KB checkout and staged their manifest entries ` +
          `in ${STAGED_MANIFEST_FILENAME}. They are marked status="inactive" / reviewStatus="pending", are ` +
          `not in kb/manifest.json (so \`npm run kb:ingest\` cannot pick them up), and are NOT retrievable ` +
          `until a clinician has corrected the machine captions and a reviewer promotes them.`,
        stagedManifest,
        processed: videoIds.length,
        saved: result.saved,
        errors: result.errors,
        skipped: [...fetchFailures, ...result.skippedReasons],
        manifestEntries: result.manifestEntries.map(e => ({
          id: e.id,
          title: e.title,
          videoId: e.url.split('v=')[1]
        }))
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException) throw error;
      this.logger.error(`Error in YouTube ingestion: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error: ${error.message}`,
        processed: 0
      };
    }
  }

  /**
   * Test endpoint to fetch a single transcript
   * POST /admin/youtube/test
   *
   * Body: { "videoId": "VIDEO_ID", "language": "hi" }
   */
  @Post("test")
  async testTranscript(@Body() body: { videoId: string; language?: string }) {
    try {
      if (!body.videoId) {
        return { success: false, message: "videoId is required" };
      }

      const transcript = await this.youtubeService.getVideoTranscript(body.videoId, body.language);

      return {
        success: true,
        videoId: transcript.videoId,
        title: transcript.title,
        language: transcript.language,
        captionTrack: transcript.captionTrack,
        machineGenerated: transcript.machineGenerated,
        machineTranslated: transcript.machineTranslated,
        textLength: transcript.text.length,
        segmentCount: transcript.segments.length,
        preview: transcript.text.substring(0, 500)
      };
    } catch (error) {
      this.logger.error(`Error testing transcript: ${error.message}`);
      return {
        success: false,
        message: error.message
      };
    }
  }
}
