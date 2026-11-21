import { HttpException, HttpStatus } from "@nestjs/common";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  const body = (status: string, database: string) => ({
    status,
    timestamp: "2026-01-01T00:00:00.000Z",
    database,
    hospitalDirectory: { loaded: true, count: 83, path: "/app/data/hospitals.json", error: null },
  });
  const controllerWith = (result: unknown) =>
    new HealthController({ check: jest.fn().mockResolvedValue(result), checkRetrieval: jest.fn() } as any);

  it("returns the body with HTTP 200 when the database answers", async () => {
    const ok = body("ok", "connected");
    await expect(controllerWith(ok).check()).resolves.toBe(ok);
  });

  it("keeps HTTP 200 for a degraded service, which the deploy gate reads from the body", async () => {
    const degraded = body("degraded", "connected");
    await expect(controllerWith(degraded).check()).resolves.toBe(degraded);
  });

  it("returns HTTP 503 with the same body shape when the database is unreachable", async () => {
    const down = body("error", "disconnected");
    const error = await controllerWith(down)
      .check()
      .then(
        () => null,
        (e) => e
      );
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(error.getResponse()).toEqual(down);
  });

  it("answers the liveness route without touching the health service", () => {
    const service = { check: jest.fn(), checkRetrieval: jest.fn() };
    const out = new HealthController(service as any).live();
    expect(out.status).toBe("ok");
    expect(service.check).not.toHaveBeenCalled();
  });
});
