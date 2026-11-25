import { buildPrompt, parseDraft, nextStepLink, VOICE_RULES, generateDraft } from "./social-generator";
import { CALENDAR } from "./content/calendar";
import { lintProse } from "./voice/voice-lint";

describe("social generator", () => {
  const brief = CALENDAR[6].brief; // what-suchi-does, generated at run time

  it("puts the owner's rules in the prompt", () => {
    for (const phrase of ["No em dashes", "No semicolons", "journey", "Do not open with a question", "No exclamation marks", "people with cancer", "Use only the facts given below"]) {
      expect(VOICE_RULES).toContain(phrase);
    }
  });

  it("gives the facts with their sources and the exact closing link", () => {
    const p = buildPrompt("facebook", brief);
    for (const f of brief.facts) expect(p).toContain(f.url);
    expect(p).toContain("put exactly this link as the final line: https://chat.suchitracancercare.org/?src=social-facebook");
  });

  it("asks Instagram for no link and forces no closing formula", () => {
    expect(nextStepLink("instagram", brief)).toBeNull();
    expect(buildPrompt("instagram", brief)).toContain("Do not put any web address");
    expect(buildPrompt("instagram", brief)).not.toContain("link is in our profile");
    expect(VOICE_RULES).toContain("Do not end on a sentence about Suchi");
  });

  it("feeds the reasons back on a retry", () => {
    const p = buildPrompt("x", brief, { text: "Old draft!", reasons: ["no exclamation marks"] });
    expect(p).toContain("- no exclamation marks");
    expect(p).toContain("Old draft!");
  });

  it("parses fenced JSON and rejects anything else", () => {
    expect(parseDraft('```json\n{"text": "Hello."}\n```')).toBe("Hello.");
    expect(parseDraft("Hello.")).toBeNull();
  });

  it("returns an error, not a draft, when the model fails", async () => {
    const r = await generateDraft({ generateRaw: async () => { throw new Error("quota"); } }, "x", brief);
    expect("error" in r && r.error).toMatch(/model error/);
  });

  it("writes its own rules in the owner's style", () => {
    // The rule list uses dashes as list markers and quotes the banned words, so check only the opening.
    expect(lintProse(VOICE_RULES.split("\n")[0])).toEqual([]);
  });
});
