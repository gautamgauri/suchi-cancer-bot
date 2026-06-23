import {
  detectLocale,
  formatForWhatsApp,
  splitForWhatsApp,
  toWhatsAppMarkdown,
  WA_MAX_LEN,
  WA_MAX_MESSAGES,
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

  it("FR-9: default threshold is 3200 and every message stays within it", () => {
    expect(WA_MAX_LEN).toBe(3200);
    const para = "word ".repeat(2000).trim(); // ~9999 chars
    const chunks = splitForWhatsApp(para);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(WA_MAX_LEN);
  });

  it("prefers paragraph boundaries when splitting", () => {
    const a = "a".repeat(3000);
    const b = "b".repeat(3000);
    const chunks = splitForWhatsApp(`${a}\n\n${b}`);
    expect(chunks).toEqual([a, b]);
  });

  it("FR-9: caps at WA_MAX_MESSAGES and invites continuation when longer", () => {
    // 5 paragraphs of ~2500 chars → one per message (~5 messages); must cap at 3.
    const paras = Array.from({ length: 5 }, (_, i) => `P${i} ` + "x".repeat(2500));
    const chunks = splitForWhatsApp(paras.join("\n\n"));
    expect(chunks.length).toBeLessThanOrEqual(WA_MAX_MESSAGES);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(WA_MAX_LEN);
    expect(chunks[chunks.length - 1].toLowerCase()).toContain("continue");
  });

  it("FR-9: never splits a safety/helpline line across messages", () => {
    const safety = "If pain is severe or breathing is difficult, call 112 (emergency) or 108 (ambulance) immediately.";
    // Fill the first message nearly to the limit, then the safety line.
    const text = "x".repeat(WA_MAX_LEN - 10) + "\n" + safety;
    const chunks = splitForWhatsApp(text);
    // The safety line must appear intact in exactly one message, never sliced.
    expect(chunks.some((c) => c.includes(safety))).toBe(true);
  });

  it("FR-9: never splits a numbered action across messages", () => {
    const action = "3. Bring your previous reports and a list of your medicines to the appointment.";
    const text = "y".repeat(WA_MAX_LEN - 10) + "\n" + action;
    const chunks = splitForWhatsApp(text);
    expect(chunks.some((c) => c.includes(action))).toBe(true);
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
