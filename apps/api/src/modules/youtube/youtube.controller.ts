import { Controller, Post, Body, UseGuards, Logger } from "@nestjs/common";
import { BasicAuthGuard } from "../../common/guards/basic-auth.guard";
import { YoutubeService } from "./youtube.service";
import { KbService } from "./kb.service";

interface IngestRequest {
  videoIds?: string[];
  videoUrls?: string[];
  channelUrl?: string;
  language?: string; // Optional: 'en', 'hi', etc.
}

@UseGuards(BasicAuthGuard)
@Controller("admin/youtube")
export class YoutubeController {
  private readonly logger = new Logger(YoutubeController.name);

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
      this.logger.log("Starting YouTube transcript ingestion");

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
      for (const videoId of videoIds) {
        try {
          const transcript = await this.youtubeService.getVideoTranscript(videoId, body.language);
          transcripts.push(transcript);

          // Rate limiting: wait 1 second between requests
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          this.logger.error(`Failed to process ${videoId}: ${error.message}`);
        }
      }

      this.logger.log(`Successfully fetched ${transcripts.length} transcripts`);

      // Save to knowledge base
      const result = await this.kbService.batchSaveToKb(transcripts);

      this.logger.log(`Ingestion complete: ${result.saved} saved, ${result.errors} errors`);

      return {
        success: true,
        message: `Successfully ingested ${result.saved} YouTube transcripts`,
        processed: videoIds.length,
        saved: result.saved,
        errors: result.errors,
        manifestEntries: result.manifestEntries.map(e => ({
          id: e.id,
          title: e.title,
          videoId: e.url.split('v=')[1]
        }))
      };
    } catch (error) {
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
