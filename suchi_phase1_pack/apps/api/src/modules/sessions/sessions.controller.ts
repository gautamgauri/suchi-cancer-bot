import { Body, Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CreateSessionDto } from "./dto";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}
  @Post()
  @Throttle({ default: { limit: 30, ttl: 60 } })
  async create(@Body() dto: CreateSessionDto) {
    const s = await this.sessions.create(dto);
    return { sessionId: s.id, createdAt: s.createdAt };
  }
}
