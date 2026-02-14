import { parseCsvList, parseDeliveryGuardConfig } from "./delivery-guard.config";

describe("delivery-guard.config", () => {
  describe("parseCsvList", () => {
    it("returns empty list for missing value", () => {
      expect(parseCsvList(undefined)).toEqual([]);
      expect(parseCsvList("")).toEqual([]);
    });

    it("trims values and drops blanks", () => {
      expect(parseCsvList(" a,  b ,, c  ")).toEqual(["a", "b", "c"]);
    });
  });

  describe("parseDeliveryGuardConfig", () => {
    it("parses delivery guard keys with sane defaults", () => {
      expect(parseDeliveryGuardConfig({})).toEqual({
        allowedSlackChannelIds: [],
        allowedEmailRecipients: [],
        allowedEmailDomains: [],
        blockExternalDelivery: false,
      });
    });

    it("normalizes recipients and domains", () => {
      const parsed = parseDeliveryGuardConfig({
        FUNDING_ALLOWED_EMAIL_RECIPIENTS: "Reviewer@Suchi.Org,ops@suchi.org",
        FUNDING_ALLOWED_EMAIL_DOMAINS: "@SUCHI.ORG, internal.suchi.org",
      });

      expect(parsed.allowedEmailRecipients).toEqual(["reviewer@suchi.org", "ops@suchi.org"]);
      expect(parsed.allowedEmailDomains).toEqual(["suchi.org", "internal.suchi.org"]);
    });

    it("parses truthy blockExternalDelivery flag", () => {
      const parsed = parseDeliveryGuardConfig({
        FUNDING_BLOCK_EXTERNAL_DELIVERY: "TrUe",
      });
      expect(parsed.blockExternalDelivery).toBe(true);
    });
  });
});
