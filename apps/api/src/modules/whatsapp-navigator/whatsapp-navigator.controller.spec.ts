import { PATH_METADATA } from "@nestjs/common/constants";
import { WhatsAppNavigatorController } from "./whatsapp-navigator.controller";

// Regression guard: the app sets a global `v1` prefix (main.ts). If this
// controller's @Controller path also starts with `v1`, the webhook serves at
// /v1/v1/whatsapp-navigator/webhook and diverges from the documented
// /v1/whatsapp-navigator/webhook path.
describe("WhatsAppNavigatorController routing", () => {
  it("does not repeat the global v1 prefix", () => {
    const path = Reflect.getMetadata(PATH_METADATA, WhatsAppNavigatorController);
    expect(path).toBe("whatsapp-navigator");
    expect(path).not.toMatch(/^v1\b/);
  });
});
