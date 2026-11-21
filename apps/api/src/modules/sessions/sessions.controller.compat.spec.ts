import { Body, Controller, INestApplication, Post, Req, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Request } from "express";
import { CreateSessionDto } from "./dto";

/**
 * Merge-order safety check for source attribution.
 *
 * Merging this branch deploys the web chat at once, but the API deploys only
 * by a manual build. So the new web client will first talk to the API built
 * from main at e1172ef. That API's session controller takes the body DTO and
 * the request, and binds no query parameters.
 *
 * LegacySessionsController below reproduces the create handler's signature
 * from e1172ef (apps/api/src/modules/sessions/sessions.controller.ts), with
 * the same CreateSessionDto (unchanged on this branch) and the global
 * ValidationPipe settings from main.ts. The handler body is reduced to
 * recording its arguments, since only the request pipeline matters here.
 */
const calls: Array<{ dto: unknown; query: unknown }> = [];

@Controller("sessions")
class LegacySessionsController {
  @Post()
  create(@Body() dto: CreateSessionDto, @Req() req: Request) {
    calls.push({ dto, query: req.query });
    return { sessionId: "s-1", createdAt: "2026-11-21T00:00:00.000Z" };
  }
}

describe("Session create on the API as built from main at e1172ef", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [LegacySessionsController] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    // Same settings as apps/api/src/main.ts at e1172ef.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    baseUrl = `${await app.getUrl()}/v1/sessions`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  const post = (query: string, body: Record<string, unknown>) =>
    fetch(`${baseUrl}${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it.each([
    ["src", "?src=site-article"],
    ["utm_source", "?utm_source=instagram"],
    ["both", "?src=site-video&utm_source=youtube"],
    ["a value the new API would drop", "?src=" + encodeURIComponent("Not A Code")],
  ])("accepts a create request carrying %s in the query string", async (_label, query) => {
    const res = await post(query, { channel: "web", userContext: "general" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ sessionId: "s-1", createdAt: "2026-11-21T00:00:00.000Z" });
    // The body reaches the handler unchanged. The query is never validated.
    expect(calls).toHaveLength(1);
    expect(calls[0].dto).toEqual({ channel: "web", userContext: "general" });
  });

  it("still rejects src sent as a body field, so the client must keep it in the query", async () => {
    const res = await post("", { channel: "web", src: "site-article" });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
