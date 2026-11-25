import { PATH_METADATA } from "@nestjs/common/constants";
import { DistributionController } from "./distribution.controller";

// Regression guard: the app sets a global `v1` prefix (main.ts). If this
// controller's @Controller path also starts with `v1`, routes serve at
// /v1/v1/distribution.
describe("DistributionController", () => {
  it("does not repeat the global v1 prefix", () => {
    const path = Reflect.getMetadata(PATH_METADATA, DistributionController);
    expect(path).toBe("distribution");
    expect(path).not.toMatch(/^v1\b/);
  });

  it("answers the old approve and reject links with a page that changes nothing", () => {
    const res = { code: 0, body: "", status(c: number) { this.code = c; return this; }, send(b: string) { this.body = b; return this; } };
    new DistributionController().retired(res as never);
    expect(res.code).toBe(410);
    expect(res.body).toContain("nothing was changed");
  });
});
