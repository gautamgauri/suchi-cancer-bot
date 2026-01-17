import { Body, Controller, InternalServerErrorException, Logger, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ChatDto } from "./dto";
import { ChatService } from "./chat.service";

@Controller("chat")
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chat: ChatService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60 } })
  async send(@Body() dto: ChatDto) {
    try {
      return await this.chat.handle(dto);
    } catch (error: any) {
      this.logger.error(`Chat error: ${error.message}`, error.stack);
      
      // Handle timeout errors gracefully
      if (error.message?.includes('timeout') || error.message?.includes('LLM generation timeout')) {
        return {
          sessionId: dto.sessionId,
          responseText: "I'm experiencing high load. Please try again in a moment.",
          safety: { classification: "normal" as const, actions: [] },
          error: "timeout"
        };
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
