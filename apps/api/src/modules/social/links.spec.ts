import { WEB_SOURCE_CODES, WHATSAPP_SOCIAL_CODES, webChatLink, whatsappLink, siteLink, carriesPlatformCode, instagramProfileLink } from "./links";
import { WHATSAPP_SOURCE_CODES, extractSourceLine } from "../whatsapp/whatsapp-source";
import { normalizeSourceCode, parseAttribution } from "../sessions/source-code";
import { tallySessionsBySource } from "../analytics/daily-report.service";
import { PLATFORMS } from "./social.types";

describe("social source codes", () => {
  it("are valid session source codes", () => {
    for (const code of [...Object.values(WEB_SOURCE_CODES), ...Object.values(WHATSAPP_SOCIAL_CODES)]) {
      expect(normalizeSourceCode(code)).toBe(code);
    }
  });

  it("are on the WhatsApp allow-list (cross-check with whatsapp-source.ts)", () => {
    for (const code of Object.values(WHATSAPP_SOCIAL_CODES)) expect(WHATSAPP_SOURCE_CODES.has(code)).toBe(true);
  });

  it("are distinct per platform", () => {
    expect(new Set(Object.values(WEB_SOURCE_CODES)).size).toBe(4);
    expect(new Set(Object.values(WHATSAPP_SOCIAL_CODES)).size).toBe(4);
  });

  it.each(PLATFORMS)("a %s WhatsApp link is read by the API as that platform's code", (p) => {
    const text = new URL(whatsappLink(p)).searchParams.get("text")!;
    const r = extractSourceLine(text, () => false);
    expect(r.sourceCode).toBe(WHATSAPP_SOCIAL_CODES[p]);
  });

  it.each(PLATFORMS)("a %s web link carries exactly its own code", (p) => {
    expect(carriesPlatformCode(webChatLink(p), p)).toBe(true);
    expect(carriesPlatformCode(siteLink("/watch/x/", p), p)).toBe(true);
    expect(carriesPlatformCode(whatsappLink(p), p)).toBe(true);
    const other = PLATFORMS.find((q) => q !== p)!;
    expect(carriesPlatformCode(webChatLink(other), p)).toBe(false);
  });

  it("does not accept a foreign site with our code", () => {
    expect(carriesPlatformCode("https://evil.example/?src=social-x", "x")).toBe(false);
  });

  it("gives Instagram a profile link with its code", () => {
    expect(instagramProfileLink()).toBe("https://suchitracancercare.org/?src=social-instagram");
  });

  it("is counted under each platform in the daily report", () => {
    // Web chat: the chat app sends ?src= to POST /v1/sessions, stored as payload.src.
    // WhatsApp: the API records the stripped code as src on the new session.
    const payloads = [
      { channel: "web", ...parseAttribution("social-linkedin", undefined) },
      { channel: "web", ...parseAttribution("social-facebook", undefined) },
      { channel: "web", ...parseAttribution("social-facebook", undefined) },
      { channel: "web", ...parseAttribution("social-x", undefined) },
      { channel: "web", ...parseAttribution("social-instagram", undefined) },
      { channel: "whatsapp", src: "wa-facebook" },
    ];
    expect(tallySessionsBySource(payloads)).toEqual([
      { source: "social-facebook", count: 2 },
      { source: "social-instagram", count: 1 },
      { source: "social-linkedin", count: 1 },
      { source: "social-x", count: 1 },
      { source: "wa-facebook", count: 1 },
    ]);
  });
});
