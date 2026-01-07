import { Body, Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ChatDto } from "./dto";
import { ChatService } from "./chat.service";

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60 } })
  async send(@Body() dto: ChatDto) {
    try {
      const result = await this.chat.handle(dto);
      return result;
    } catch (error: any) {
      throw error;
    }
  }
}
