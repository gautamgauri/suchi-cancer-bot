import { extractSourceLine, SOURCE_ONLY_TEXT } from "./whatsapp-source";

/** The prefilled message on the website's "Ask on WhatsApp" links. */
function siteGreeting(code: string): string {
  return `नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।\nHello Suchi, I would like some information.\n(src: ${code})`;
}

const SITE_CODES = ["wa-header", "wa-article", "wa-video", "wa-hospitals"];

describe("extractSourceLine", () => {
  it.each(SITE_CODES)("reads and strips the site's source line: %s", (code) => {
    const out = extractSourceLine(siteGreeting(code));
    expect(out.sourceCode).toBe(code);
    expect(out.text).toBe("नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।\nHello Suchi, I would like some information.");
    expect(out.text).not.toContain("src");
  });

  it("accepts CRLF line breaks and trailing spaces on the source line", () => {
    const out = extractSourceLine("Hello Suchi\r\n(src: wa-video)  ");
    expect(out).toEqual({ text: "Hello Suchi", sourceCode: "wa-video" });
  });

  it("treats a message that is only the source line as a plain greeting", () => {
    expect(extractSourceLine("(src: wa-header)")).toEqual({ text: SOURCE_ONLY_TEXT, sourceCode: "wa-header" });
    expect(extractSourceLine("\n\n(src: wa-header)")).toEqual({ text: SOURCE_ONLY_TEXT, sourceCode: "wa-header" });
  });

  it.each([
    ["upper case", "Hello\n(src: WA-Header)"],
    ["a space inside the code", "Hello\n(src: wa header)"],
    ["a dot in the code", "Hello\n(src: wa.header)"],
    ["a code longer than 32 characters", `Hello\n(src: ${"a".repeat(33)})`],
    ["an empty code", "Hello\n(src: )"],
    ["no space after the colon", "Hello\n(src:wa-header)"],
    ["a URL as the code", "Hello\n(src: https://example.org)"],
    ["extra text on the line", "Hello\n(src: wa-header) thanks"],
  ])("leaves an invalid source line in the text: %s", (_label, text) => {
    expect(extractSourceLine(text)).toEqual({ text });
  });

  it("leaves a source line that is not the last line in the text", () => {
    const text = "Hello\n(src: wa-header)\nI have a question";
    expect(extractSourceLine(text)).toEqual({ text });
  });

  it("leaves ordinary messages alone", () => {
    for (const text of ["Hello", "breast cancer ke symptoms kya hain?", "(this is in brackets)"]) {
      expect(extractSourceLine(text)).toEqual({ text });
    }
  });

  it("returns quickly on long input", () => {
    const long = "(src: " + "a(".repeat(5_000);
    const started = process.hrtime.bigint();
    expect(extractSourceLine(long)).toEqual({ text: long });
    expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(50);
  });
});
