import { Body, Controller, GatewayTimeoutException, InternalServerErrorException, Logger, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ChatDto } from "./dto";
import { ChatService } from "./chat.service";

/** Pattern to match [citation:docId:chunkId] markers */
const CITATION_MARKER_PATTERN = /\[citation:[^\]]+\]/g;
/** Pattern to match numbered references like [1], [2] left over from LLM output */
const NUMBERED_REF_PATTERN = /\s*\[\d{1,3}\]/g;
/** Pattern to match the raw "**Sources:** [citation:...]" section appended by citation repair */
const RAW_SOURCES_SECTION_PATTERN = /\n\n\*\*Sources:\*\*\s*(\[citation:[^\]]+\]\s*)+/g;

@Controller("chat")
export class ChatController {
  private readonly logger = new Logger(ChatController.name);
  private readonly REQUEST_TIMEOUT_MS = 180000; // 180 seconds (3 minutes) to match eval framework timeout and allow for complex LLM responses with deterministic extractor

  constructor(private readonly chat: ChatService) {}

  /**
   * Clean response text for user display.
   * Strips raw citation markers, numbered refs, and raw sources sections
   * so the user sees clean, readable text. The structured citations data
   * is still returned separately in the response for the frontend to render.
   */
  private cleanResponseForDisplay(text: string): string {
    return text
      .replace(RAW_SOURCES_SECTION_PATTERN, "")
      .replace(CITATION_MARKER_PATTERN, "")
      .replace(NUMBERED_REF_PATTERN, "")
      // Clean up any leftover double-spaces from removed markers
      .replace(/  +/g, " ")
      // Clean up any leftover empty bold markers like "** **"
      .replace(/\*\*\s*\*\*/g, "")
      .trim();
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60 } })
  async send(@Body() dto: ChatDto) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('REQUEST_TIMEOUT'));
      }, this.REQUEST_TIMEOUT_MS);
    });

    try {
      // Race between the actual request and timeout
      const result = await Promise.race([
        this.chat.handle(dto),
        timeoutPromise
      ]) as any;

      // Clean the response text for display (strip citation markers, numbered refs)
      // The raw text is preserved in the database for evaluation purposes
      if (result && result.responseText) {
        result.responseText = this.cleanResponseForDisplay(result.responseText);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Chat error: ${error.message}`, error.stack);
      
      // Handle timeout errors gracefully
      if (error.message === 'REQUEST_TIMEOUT' || 
          error.message?.includes('timeout') || 
          error.message?.includes('LLM generation timeout') ||
          error.message?.includes('aborted')) {
        this.logger.warn(`Request timeout after ${this.REQUEST_TIMEOUT_MS}ms for session ${dto.sessionId}`);
        throw new GatewayTimeoutException({
          sessionId: dto.sessionId,
          responseText: "I'm experiencing high load. Please try again in a moment.",
          safety: { classification: "normal" as const, actions: [] },
          error: "timeout"
        });
      }
      
      // Re-throw known errors (BadRequestException, etc.) as-is
      if (error.statusCode || error.status) {
        throw error;
      }
      
      // For unknown errors, return a user-friendly message
      throw new InternalServerErrorException("An error occurred processing your request");
    }
  }
}
