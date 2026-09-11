import {
  detectLocale,
  formatForWhatsApp,
  splitForWhatsApp,
  toWhatsAppMarkdown,
  WA_MAX_LEN,
  WA_MAX_MESSAGES,
} from "./whatsapp-format";
import { appendDisclaimer } from "../safety/disclaimer-engine";
import { evaluateEmergencyFastPath } from "../safety/emergency-fast-path";
import { ResponseTemplates } from "../chat/response-templates";

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

// Regression tests for #116: internal markup delivered to patients on the live
// WhatsApp channel (2026-09-10). Strings below are the exact leaked fragments
// quoted in the issue (no patient data — bot output only).
describe("toWhatsAppMarkdown — internal markup must not reach the patient (#116)", () => {
  it("strips [citation:docId:chunkId] markers, including internal KB doc ids", () => {
    const leaked =
      "Bleeding and Bruising and Cancer Treatment - Side Effects - NCI [citation:kb_en_nci_about_cancer_treatment_side_effects_bleeding_bruising_v1:kb_en_nci_about_cancer_treatment_side_effects_bleeding_bruising_v1::chunk::0]";
    const out = toWhatsAppMarkdown(leaked);
    expect(out).toBe("Bleeding and Bruising and Cancer Treatment - Side Effects - NCI");
    expect(out).not.toMatch(/\[citation:/);
    expect(out).not.toContain("kb_en_");
  });

  it("strips several citation markers on consecutive lines and leaves the sentences intact", () => {
    const leaked = [
      "Red flags (seek urgent care now) If you experience any of these symptoms, seek immediate medical attention: - Severe shortness of breath or chest... [citation:kb_en_red_flags_urgent_care_v1:kb_en_red_flags_urgent_care_v1::chunk::0]",
      "Coping with breast cancer treatment Cancer treatment can cause side effects or changes to your body and how you feel. [citation:kb_en_nci_types_breast_breast_cancer_survivorship_v1:kb_en_nci_types_breast_breast_cancer_survivorship_v1::chunk::1]",
    ].join("\n");
    const out = toWhatsAppMarkdown(leaked);
    expect(out).not.toMatch(/\[citation:/);
    expect(out).toContain("seek immediate medical attention");
    expect(out).toContain("changes to your body and how you feel.");
    expect(out.split("\n")).toHaveLength(2);
  });

  it("strips a mid-sentence marker without leaving a double space before the period", () => {
    expect(toWhatsAppMarkdown("Chemo can cause fatigue [citation:doc:chunk]. Rest helps.")).toBe(
      "Chemo can cause fatigue. Rest helps.",
    );
  });

  it("strips the raw '**Sources:**' block appended by citation repair (same as the web controller)", () => {
    const text = "Answer text.\n\n**Sources:** [citation:kb_a:kb_a::chunk::0] [citation:kb_b:kb_b::chunk::2]";
    expect(toWhatsAppMarkdown(text)).toBe("Answer text.");
  });

  it("strips [source:...] markers (voice parity)", () => {
    expect(toWhatsAppMarkdown("Text [source:kb_x]")).toBe("Text");
  });

  it("renders a RELATIVE markdown link as its label only (no dead path delivered)", () => {
    const leaked =
      "Side effects of chemotherapy The most common side effect of chemotherapy is [fatigue](/about-cancer/treatment/side-effects/fatigue), which is feeling exhausted or extremely tired.";
    expect(toWhatsAppMarkdown(leaked)).toBe(
      "Side effects of chemotherapy The most common side effect of chemotherapy is fatigue, which is feeling exhausted or extremely tired.",
    );
  });

  it("still rewrites ABSOLUTE links to 'label: url'", () => {
    expect(toWhatsAppMarkdown("[NCI](https://www.cancer.gov/x) and [anchor](#top) and [rel](./page)")).toBe(
      "NCI: https://www.cancer.gov/x and anchor and rel",
    );
  });

  it("drops the '---' separator line emitted by the disclaimer append, keeping the disclaimer", () => {
    const leaked =
      "Would you like me to help you think of some questions to ask your doctor during your visit?\n\n---\n*This information is for general educational purposes only and is not a substitute for professional medical advice, diagnosis, or treatment. Always consult your healthcare provider for personalized guidance.*";
    const out = toWhatsAppMarkdown(leaked);
    expect(out).not.toMatch(/^-{3,}$/m);
    expect(out).toContain("questions to ask your doctor during your visit?");
    expect(out).toContain("This information is for general educational purposes only");
    // No stray blank-line run where the rule used to be.
    expect(out).not.toMatch(/\n{3,}/);
  });

  it("drops '***' / '___' rules and the template closing-note '---' too", () => {
    const text = "Track your temperature daily\n\n---\n_Every patient's experience is different._\n***\nend\n___";
    const out = toWhatsAppMarkdown(text);
    expect(out).not.toMatch(/^[-*_]{3,}$/m);
    expect(out).toContain("Every patient's experience is different.");
    expect(out).toContain("end");
  });

  it("does not mistake a bullet or a hyphenated word for a horizontal rule", () => {
    expect(toWhatsAppMarkdown("- one\n-- not a rule --\nwell-known")).toBe("• one\n-- not a rule --\nwell-known");
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

  // #116 follow-up check: emergency content must arrive whole. The S2 urgent
  // template + emergency disclaimer is the exact composition the chat pipeline
  // sends for a red flag (chat.service urgency branch → appendDisclaimer).
  it("delivers the S2 emergency template + emergency disclaimer as ONE message with every bullet intact", () => {
    const composed = appendDisclaimer(ResponseTemplates.S2({ isFirstMessage: true, userText: "x" } as any), "en", true);
    const msgs = formatForWhatsApp(composed);
    expect(msgs).toHaveLength(1);
    const body = msgs[0];
    expect(body).toContain("• *112* (national emergency number) or *108* (ambulance service)");
    expect(body).toContain("• If you have severe bleeding, apply gentle pressure if possible (without causing more harm)");
    expect(body).toContain("If this is a medical emergency, call 112 or 108 immediately.");
    expect(body).not.toMatch(/^-{3,}$/m);
    expect(body.length).toBeLessThanOrEqual(WA_MAX_LEN);
  });

  it("delivers the emergency fast-path response as ONE message", () => {
    const fp = evaluateEmergencyFastPath("She collapsed during chemo");
    expect(fp.isEmergency).toBe(true);
    const msgs = formatForWhatsApp(appendDisclaimer(fp.responseText!, "en", true));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("112");
    expect(msgs[0]).toContain("108");
  });

  it("keeps every emergency bullet whole even when the template straddles a message boundary", () => {
    const s2 = toWhatsAppMarkdown(ResponseTemplates.S2({ isFirstMessage: true, userText: "x" } as any));
    const bullets = s2.split("\n").filter((l) => l.startsWith("• "));
    expect(bullets.length).toBeGreaterThan(5);
    // Pad so the S2 block begins near the end of message 1.
    const padded = "p".repeat(WA_MAX_LEN - 400) + "\n\n" + s2;
    const msgs = formatForWhatsApp(padded);
    expect(msgs.length).toBeGreaterThan(1);
    for (const b of bullets) expect(msgs.some((m) => m.includes(b))).toBe(true);
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
