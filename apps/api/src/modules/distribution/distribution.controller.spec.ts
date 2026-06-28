import { PATH_METADATA } from "@nestjs/common/constants";
import { DistributionController } from "./distribution.controller";

// Regression guard: the app sets a global `v1` prefix (main.ts). If this
// controller's @Controller path also starts with `v1`, routes serve at
// /v1/v1/distribution and the pack-mailer approval links (which point at
// /v1/distribution/...) 404 — silently breaking the one-click approve flow.
describe("DistributionController routing", () => {
  it("does not repeat the global v1 prefix", () => {
    const path = Reflect.getMetadata(PATH_METADATA, DistributionController);
    expect(path).toBe("distribution");
    expect(path).not.toMatch(/^v1\b/);
  });
});
