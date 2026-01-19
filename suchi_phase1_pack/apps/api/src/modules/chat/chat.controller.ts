import { Body, Controller, GatewayTimeoutException, InternalServerErrorException, Logger, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ChatDto } from "./dto";
import { ChatService } from "./chat.service";

@Controller("chat")
export class ChatController {
  private readonly logger = new Logger(ChatController.name);
  private readonly REQUEST_TIMEOUT_MS = 45000; // 45 seconds overall timeout (increased for structured LLM responses)

  constructor(private readonly chat: ChatService) {}

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
      return await Promise.race([
        this.chat.handle(dto),
        timeoutPromise
      ]) as any;
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
