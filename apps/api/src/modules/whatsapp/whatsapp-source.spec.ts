import { flaggedByDeterministicSafetyChecks } from "../chat/deterministic-safety";
import {
  extractSourceLine,
  PREFILLED_ENGLISH_LINE,
  PREFILLED_HINDI_LINE,
  SOURCE_ONLY_TEXT,
  WHATSAPP_SOURCE_CODES,
} from "./whatsapp-source";

/** The shared deterministic safety check, as WhatsAppService passes it. */
const flagged = (text: string) => flaggedByDeterministicSafetyChecks(text);
const extract = (text: string) => extractSourceLine(text, flagged);

const GREETING = `${PREFILLED_HINDI_LINE}\n${PREFILLED_ENGLISH_LINE}`;
const siteGreeting = (code: string) => `${GREETING}\n(src: ${code})`;
const SITE_CODES = ["wa-header", "wa-article", "wa-video", "wa-hospitals"];

describe("extractSourceLine", () => {
  it("allows exactly the site and print codes", () => {
    expect([...WHATSAPP_SOURCE_CODES].sort()).toEqual(
      ["wa-article", "wa-header", "wa-hospitals", "wa-poster", "wa-qr", "wa-video"],
    );
  });

  it.each(SITE_CODES)("reads and strips the site's source line: %s", (code) => {
    expect(extract(siteGreeting(code))).toEqual({ text: GREETING, sourceCode: code });
  });

  it.each(["wa-qr", "wa-poster"])("reads a print code: %s", (code) => {
    expect(extract(`Hello\n(src: ${code})`)).toEqual({ text: "Hello", sourceCode: code });
  });

  it("accepts CRLF line breaks, trailing spaces and a trailing newline", () => {
    expect(extract("Hello Suchi\r\n(src: wa-video)  ")).toEqual({ text: "Hello Suchi", sourceCode: "wa-video" });
    expect(extract(`${siteGreeting("wa-video")}\n`)).toEqual({ text: GREETING, sourceCode: "wa-video" });
    expect(extract(`${siteGreeting("wa-video")}\n\n  `)).toEqual({ text: GREETING, sourceCode: "wa-video" });
  });

  it("treats a message that is only the source line as a plain greeting", () => {
    expect(extract("(src: wa-header)")).toEqual({ text: SOURCE_ONLY_TEXT, sourceCode: "wa-header" });
  });

  // Review B1: a safety word in the code position used to be stripped.
  it.each([
    "(src: suicide)",
    "hello\n(src: suicide)",
    "(src: seizure)",
    "hello\n(src: unconscious)",
    "(src: site-article)",
    "(src: wa-unknown)",
    "(src: utm)",
  ])("leaves a code that is not on the allow-list in the text: %j", (text) => {
    expect(extract(text)).toEqual({ text });
  });

  it.each([
    ["upper case", "Hello\n(src: WA-HEADER)"],
    ["a space inside the code", "Hello\n(src: wa header)"],
    ["no space after the colon", "Hello\n(src:wa-header)"],
    ["extra text on the line", "Hello\n(src: wa-header) thanks"],
    ["a URL as the code", "Hello\n(src: https://example.org)"],
  ])("leaves a malformed source line in the text: %s", (_label, text) => {
    expect(extract(text)).toEqual({ text });
  });

  // Review F4: WhatsApp leaves the cursor after the code line.
  it.each([
    ["a symptom question", "mere stan mein gaanth hai, kya karun?"],
    ["an emergency phrase", "खून बहुत आ रहा है"],
    ["an ordinary question", "What is chemotherapy?"],
    ["two typed lines", "my mother has cancer\nwhat should we do next"],
  ])("with %s typed after the code line, passes on exactly what was typed", (_label, typed) => {
    expect(extract(`${siteGreeting("wa-article")}\n${typed}`)).toEqual({ text: typed, sourceCode: "wa-article" });
  });

  it("keeps text the visitor typed above the greeting", () => {
    expect(extract(`please help\n${siteGreeting("wa-video")}\nwhat is a biopsy`)).toEqual({
      text: "please help\nwhat is a biopsy",
      sourceCode: "wa-video",
    });
  });

  it("removes only the code line when the lines above it are not the prefilled greeting", () => {
    expect(extract("Hello Suchi\n(src: wa-article)\nwhat is a biopsy")).toEqual({
      text: "Hello Suchi\nwhat is a biopsy",
      sourceCode: "wa-article",
    });
  });

  it("reads only the first allow-listed code line", () => {
    expect(extract("Hello\n(src: wa-header)\n(src: wa-video)")).toEqual({
      text: "Hello\n(src: wa-video)",
      sourceCode: "wa-header",
    });
  });

  it("backstop: never strips when that would change the safety outcome", () => {
    const calls: string[] = [];
    // A stand-in check that flags only the raw text, to exercise the backstop.
    const raw = `${siteGreeting("wa-article")}\nhello`;
    const out = extractSourceLine(raw, (t) => {
      calls.push(t);
      return t === raw;
    });
    expect(out).toEqual({ text: raw });
    expect(calls).toContain(raw);
  });

  it("with the real check, a typed emergency phrase is still flagged after stripping", () => {
    const raw = `${siteGreeting("wa-article")}\nखून बहुत आ रहा है`;
    const out = extract(raw);
    expect(flagged(raw)).toBe(true);
    expect(flagged(out.text)).toBe(true);
    expect(out.sourceCode).toBe("wa-article");
  });

  it("leaves ordinary messages alone", () => {
    for (const text of ["Hello", "breast cancer ke symptoms kya hain?", "(this is in brackets)"]) {
      expect(extract(text)).toEqual({ text });
    }
  });

  it("returns quickly on long input", () => {
    const long = "(src: " + "a(\n".repeat(5_000);
    const started = process.hrtime.bigint();
    expect(extract(long)).toEqual({ text: long });
    expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(200);
  });
});
