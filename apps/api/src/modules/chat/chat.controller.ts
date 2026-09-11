import { Body, Controller, GatewayTimeoutException, InternalServerErrorException, Logger, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ChatDto } from "./dto";
import { ChatService } from "./chat.service";
import { cleanResponseForDisplay } from "./display-text-cleaner";
import {
  CHAT_TURN_TIMEOUT_MS,
  isChatTimeoutError,
  REQUEST_TIMEOUT_ERROR,
  TIMEOUT_GUIDANCE_TEXT,
} from "./timeout-fallback";

@Controller("chat")
export class ChatController {
  private readonly logger = new Logger(ChatController.name);
  // Shared with the WhatsApp worker (timeout-fallback.ts) so both channels bound a turn identically.
  private readonly REQUEST_TIMEOUT_MS = CHAT_TURN_TIMEOUT_MS;

  constructor(private readonly chat: ChatService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60 } })
  async send(@Body() dto: ChatDto) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, this.REQUEST_TIMEOUT_MS);

    try {
      // Race between the actual request and timeout
      const result = await Promise.race([
        this.chat.handle(dto, abortController.signal),
        new Promise((_, reject) => {
          abortController.signal.addEventListener('abort', () =>
            reject(new Error(REQUEST_TIMEOUT_ERROR))
          );
        }),
      ]) as any;
      clearTimeout(timeoutId);

      // Clean the response text for display (strip citation markers, numbered refs)
      // The raw text is preserved in the database for evaluation purposes
      if (result && result.responseText) {
        result.responseText = cleanResponseForDisplay(result.responseText);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Chat error: ${error.message}`, error.stack);
      
      // Handle timeout errors gracefully (same predicate + copy as the WhatsApp worker)
      if (isChatTimeoutError(error)) {
        this.logger.warn(`Request timeout after ${this.REQUEST_TIMEOUT_MS}ms for session ${dto.sessionId}`);
        throw new GatewayTimeoutException({
          sessionId: dto.sessionId,
          responseText: TIMEOUT_GUIDANCE_TEXT,
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
