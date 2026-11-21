import { normalizeSourceCode, parseAttribution, SOURCE_CODE_MAX_LENGTH } from "./source-code";

describe("normalizeSourceCode", () => {
  it.each(["site-article", "yt", "qr-poster", "whatsapp_status", "a", "x1", "a".repeat(SOURCE_CODE_MAX_LENGTH)])(
    "keeps the short code %s",
    (code) => {
      expect(normalizeSourceCode(code)).toBe(code);
    },
  );

  it.each([
    ["empty", ""],
    ["upper case", "YT"],
    ["mixed case", "Site-Article"],
    ["space", "qr poster"],
    ["URL", "https://example.com/page"],
    ["path", "a/b"],
    ["dot", "site.article"],
    ["markup", "<script>"],
    ["percent-encoded", "a%20b"],
    ["Devanagari", "पोस्टर"],
    ["too long", "a".repeat(SOURCE_CODE_MAX_LENGTH + 1)],
    ["trailing newline", "yt\n"],
  ])("drops %s", (_label, value) => {
    expect(normalizeSourceCode(value)).toBeUndefined();
  });

  it.each([
    ["array (repeated query param)", ["yt", "qr"]],
    ["object", { a: "b" }],
    ["number", 42],
    ["null", null],
    ["undefined", undefined],
  ])("drops a non-string: %s", (_label, value) => {
    expect(normalizeSourceCode(value)).toBeUndefined();
  });
});

describe("parseAttribution", () => {
  it("returns only the fields that pass", () => {
    expect(parseAttribution("site-article", "instagram")).toEqual({ src: "site-article", utmSource: "instagram" });
    expect(parseAttribution("site-article", "Instagram")).toEqual({ src: "site-article" });
    expect(parseAttribution(undefined, "newsletter")).toEqual({ utmSource: "newsletter" });
    expect(parseAttribution("https://evil.example", undefined)).toEqual({});
  });
});
