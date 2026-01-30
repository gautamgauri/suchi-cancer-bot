import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import * as geoip from "geoip-lite";
import { CreateSessionDto } from "./dto";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}
  @Post()
  @Throttle({ default: { limit: 30, ttl: 60 } })
  async create(@Body() dto: CreateSessionDto, @Req() req: Request) {
    // Extract client IP (handle proxies like Cloud Run)
    const forwardedFor = req.headers["x-forwarded-for"];
    const clientIp = typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0].trim()
      : req.ip || req.socket.remoteAddress || "";

    // Resolve geolocation from IP (local database, no external API call)
    const geo = geoip.lookup(clientIp);
    const geoData = geo
      ? { city: geo.city || null, region: geo.region || null, country: geo.country || null }
      : { city: null, region: null, country: null };

    const s = await this.sessions.create(dto, geoData);
    return { sessionId: s.id, createdAt: s.createdAt };
  }

  @Get(":sessionId")
  @Throttle({ default: { limit: 60, ttl: 60 } })
  async getSession(@Param("sessionId") sessionId: string) {
    return this.sessions.getSession(sessionId);
  }
}
