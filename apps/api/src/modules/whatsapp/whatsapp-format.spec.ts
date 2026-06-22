import {
  detectLocale,
  formatForWhatsApp,
  splitForWhatsApp,
  toWhatsAppMarkdown,
  WA_MAX_LEN,
} from "./whatsapp-format";

describe("toWhatsAppMarkdown", () => {
  it("converts ** bold ** to WhatsApp *bold*", () => {
    expect(toWhatsAppMarkdown("This is **important** text")).toBe("This is *important* text");
  });

  it("converts __bold__ to *bold*", () => {
    expect(toWhatsAppMarkdown("__strong__ word")).toBe("*strong* word");
  });

  it("rewrites markdown links to 'label: url'", () => {
    expect(toWhatsAppMarkdown("See [our site](https://suchicancercare.org/x)")).toBe(
      "See our site: https://suchicancercare.org/x",
    );
  });

  it("turns headings into bold lines", () => {
    expect(toWhatsAppMarkdown("## Treatment options")).toBe("*Treatment options*");
  });

  it("normalises list bullets to •", () => {
    expect(toWhatsAppMarkdown("- one\n- two")).toBe("• one\n• two");
  });

  it("strips inline code backticks", () => {
    expect(toWhatsAppMarkdown("run `npm test` now")).toBe("run npm test now");
  });

  it("collapses excessive blank lines", () => {
    expect(toWhatsAppMarkdown("a\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("splitForWhatsApp", () => {
  it("returns a single chunk for short text", () => {
    expect(splitForWhatsApp("hello")).toEqual(["hello"]);
  });

  it("returns empty array for blank text", () => {
    expect(splitForWhatsApp("   ")).toEqual([]);
  });

  it("splits text exceeding the limit into multiple chunks, each within the limit", () => {
    const para = "word ".repeat(2000).trim(); // ~9999 chars
    const chunks = splitForWhatsApp(para);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(WA_MAX_LEN);
    // No content lost (modulo whitespace)
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(para.replace(/\s+/g, " "));
  });

  it("prefers paragraph boundaries when splitting", () => {
    const a = "a".repeat(3000);
    const b = "b".repeat(3000);
    const chunks = splitForWhatsApp(`${a}\n\n${b}`);
    expect(chunks).toEqual([a, b]);
  });
});

describe("formatForWhatsApp", () => {
  it("translates then splits", () => {
    expect(formatForWhatsApp("**hi** there")).toEqual(["*hi* there"]);
  });
});

describe("detectLocale", () => {
  it("detects Hindi from Devanagari", () => {
    expect(detectLocale("कैंसर के लक्षण")).toBe("hi");
  });

  it("defaults to English otherwise", () => {
    expect(detectLocale("what are the symptoms")).toBe("en");
  });

  it("treats Hinglish containing Devanagari as Hindi", () => {
    expect(detectLocale("mujhe cancer के बारे में jaanna hai")).toBe("hi");
  });
});
