import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

jest.mock("geoip-lite", () => ({ lookup: () => null }));

/**
 * HTTP-level checks with the same ValidationPipe settings as main.ts.
 *
 * The web client sends attribution as query parameters on POST /v1/sessions.
 * The "body field" case below shows why: with forbidNonWhitelisted, the API
 * answers 400 to any unknown body field, so a client that put `src` in the
 * body would break session creation against an API without this change.
 */
describe("SessionsController attribution (HTTP)", () => {
  let app: INestApplication;
  let baseUrl: string;
  const create = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60, limit: 1000 }])],
      controllers: [SessionsController],
      providers: [{ provide: SessionsService, useValue: { create, getSession: jest.fn() } }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, "127.0.0.1");
    baseUrl = `${await app.getUrl()}/v1/sessions`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ id: "s-1", createdAt: new Date("2026-11-21T00:00:00Z") });
  });

  const post = (query: string, body: Record<string, unknown> = { channel: "web" }) =>
    fetch(`${baseUrl}${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("passes a valid src and utm_source from the query string to the service", async () => {
    const res = await post("?src=site-article&utm_source=instagram");
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][3]).toEqual({ src: "site-article", utmSource: "instagram" });
  });

  it("creates the session with no attribution when none is given", async () => {
    const res = await post("");
    expect(res.status).toBe(201);
    expect(create.mock.calls[0][3]).toEqual({});
  });

  it.each([
    ["a URL", "?src=" + encodeURIComponent("https://example.com/x")],
    ["upper case", "?src=YT"],
    ["free text", "?src=" + encodeURIComponent("my aunt sent me")],
    ["an over-long code", "?src=" + "a".repeat(33)],
    ["a repeated parameter", "?src=yt&src=qr"],
  ])("drops %s silently and still creates the session", async (_label, query) => {
    const res = await post(query);
    expect(res.status).toBe(201);
    expect(create.mock.calls[0][3]).toEqual({});
  });

  it("rejects src as a body field, which is why the client never sends it there", async () => {
    const res = await post("", { channel: "web", src: "yt" });
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
