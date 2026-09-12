import { HealthService } from "./health.service";
import {
  recordHospitalDirectoryStatus,
  resetHospitalDirectoryStatusForTests,
} from "../../common/hospital-directory-file";

describe("HealthService", () => {
  const okPrisma = { $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]) } as any;
  const deadPrisma = { $queryRaw: jest.fn().mockRejectedValue(new Error("connection refused")) } as any;
  // Retrieval sub-status (#92) is reported alongside but never changes top-level status.
  const kbFts = { getHealth: () => ({ status: "ok" }), probe: jest.fn() } as any;

  beforeEach(() => resetHospitalDirectoryStatusForTests());

  it("is ok when the database answers and the hospital directory is loaded", async () => {
    recordHospitalDirectoryStatus({ loaded: true, count: 83, path: "/app/data/hospitals.json", error: null });
    const out = await new HealthService(okPrisma, kbFts).check();
    expect(out.status).toBe("ok");
    expect(out.database).toBe("connected");
    expect(out.hospitalDirectory).toMatchObject({ loaded: true, count: 83 });
    expect(out.retrieval.fullTextSearch).toMatchObject({ status: "ok" });
  });

  // Issue #123: this is the state production sat in for ten days while
  // /v1/health said "ok". It must now be visible.
  it("is degraded (not ok) when the database answers but the directory did not load", async () => {
    recordHospitalDirectoryStatus({ loaded: false, count: 0, path: "/app/data/hospitals.json", error: "ENOENT" });
    const out = await new HealthService(okPrisma, kbFts).check();
    expect(out.status).toBe("degraded");
    expect(out.database).toBe("connected");
    expect(out.hospitalDirectory).toMatchObject({ loaded: false, error: "ENOENT" });
  });

  it("is error when the database is unreachable, regardless of the directory", async () => {
    recordHospitalDirectoryStatus({ loaded: true, count: 83, path: "/app/data/hospitals.json", error: null });
    const out = await new HealthService(deadPrisma, kbFts).check();
    expect(out.status).toBe("error");
    expect(out.database).toBe("disconnected");
  });
});
