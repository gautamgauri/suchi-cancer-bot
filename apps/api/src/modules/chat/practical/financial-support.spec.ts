import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildFinancialAnswer,
  FINANCIAL_SUPPORT_PATH,
  loadFinancialSupport,
  practicalUnknownReply,
  VerifiedFact,
} from "./financial-support";
import { routePracticalQuestion } from "./practical-router";

/**
 * The verified financial support file and the replies built from it
 * (issue #260). The file may hold only facts the verified reference marks as
 * confirmed on an official page, and a reply may state only those facts.
 */
const REFERENCE_PATH = path.resolve(__dirname, "../../../../../../docs/support/financial-support-reference-2026-11.json");
const referenceText = fs.readFileSync(REFERENCE_PATH, "utf8");
const reference = JSON.parse(referenceText);
const file = loadFinancialSupport();

function allFacts(): VerifiedFact[] {
  return [...Object.values(file.topics).flatMap((t) => t.facts), ...file.states.flatMap((s) => s.facts)];
}

function referenceUrls(): Set<string> {
  const urls = new Set<string>();
  const walk = (o: any) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (k === "url" && typeof v === "string") urls.add(v);
        walk(v);
      }
    }
  };
  walk(reference);
  return urls;
}

describe("the verified financial support file", () => {
  it("is the file the service reads", () => {
    expect(fs.existsSync(FINANCIAL_SUPPORT_PATH)).toBe(true);
  });

  it("rests every fact on reference text, an official page in the reference, and the reference's date", () => {
    const urls = referenceUrls();
    for (const f of allFacts()) {
      expect({ fact: f.text, quoted: referenceText.includes(f.reference_quote) }).toEqual({ fact: f.text, quoted: true });
      expect({ fact: f.text, url: urls.has(f.url) }).toEqual({ fact: f.text, url: true });
      expect(f.checked_on).toBe(reference.checked_on);
    }
  });

  // Review of PR #267, item 3. A changed phone number, amount, percentage, age
  // or day count in a fact's text must fail here, not only a changed quote.
  it("finds every number in a fact's text and in each helpline in that fact's own reference entry", () => {
    // Whole number tokens, compared exactly. Separators inside a number
    // (spaces, hyphens, commas) are dropped, and a unit that follows it
    // (lakh, crore, %, days, years, months, km) is part of the token, so
    // "Rs 25 lakh" cannot pass on the strength of "Rs 15 lakh". The reference
    // side leaves out `checked_on` and `url`, so a date or a link cannot
    // supply a number.
    const tokens = (text: string): Set<string> => {
      const out = new Set<string>();
      const re = /(\d(?:[\d,]|[\s\-‐‑–](?=\d))*)(?:\s*(lakhs?|crores?|%|days?|years?|months?|km)(?![a-z]))?/gi;
      for (const m of text.replace(/₹/g, " ").matchAll(re)) {
        const unit = (m[2] ?? "").toLowerCase().replace(/s$/, "");
        out.add(m[1].replace(/[\s,\-‐‑–]/g, "") + unit);
      }
      return out;
    };
    const referenceText = (entry: any): string => {
      const parts: string[] = [];
      const walk = (o: any, key = "") => {
        if (key === "url" || key === "checked_on") return;
        if (typeof o === "string") parts.push(o);
        else if (Array.isArray(o)) o.forEach((x) => walk(x));
        else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, k);
      };
      walk(entry);
      return parts.join(" | ");
    };
    const entryFor = (quote: string): Set<string> => {
      const entries = [...reference.national_facts, ...reference.states];
      const hit = entries.find((e: any) => referenceText(e).includes(quote));
      if (!hit) throw new Error(`no reference entry holds: ${quote}`);
      return tokens(referenceText(hit));
    };
    const check = (label: string, text: string, ref: Set<string>) => {
      for (const n of tokens(text)) {
        expect({ label, number: n, inEntry: ref.has(n) }).toEqual({ label, number: n, inEntry: true });
      }
    };
    for (const f of allFacts()) check(f.text, f.text, entryFor(f.reference_quote));
    for (const t of Object.values(file.topics)) {
      if (!t.helpline) continue;
      const ref = new Set(t.facts.flatMap((f) => [...entryFor(f.reference_quote)]));
      check(t.name, t.helpline, ref);
    }
    for (const st of file.states) {
      check(st.state, st.helpline ?? "", tokens(referenceText(reference.states.find((r: any) => r.state === st.state))));
    }
  });

  it("holds every state the reference confirmed, with its page and helpline, and no other", () => {
    expect(file.states.map((s) => s.state)).toEqual(reference.states.map((s: any) => s.state));
    for (const s of file.states) {
      const ref = reference.states.find((r: any) => r.state === s.state);
      expect({ state: s.state, url: s.url, helpline: s.helpline }).toEqual({ state: s.state, url: ref.url, helpline: ref.helpline });
    }
  });

  it("lists as not confirmed every state the reference could not confirm", () => {
    const notConfirmed = reference.not_confirmed.map((n: any) => n.item as string).join(" | ");
    for (const state of ["Maharashtra", "Andhra Pradesh", "Telangana", "Madhya Pradesh", "Chhattisgarh", "Jammu and Kashmir", "Manipur", "Gujarat", "Delhi"]) {
      expect(notConfirmed).toContain(state);
      expect(file.states_not_confirmed).toContain(state);
    }
  });

  it("states no amount for the Discretionary Grant, which the reference could not confirm", () => {
    const hmdg = file.topics.central_funds.facts.find((f) => f.id === "hmdg_what")!;
    expect(hmdg.text).not.toMatch(/Rs|lakh|\d/);
  });

  it("holds the national helpline as the reference gives it", () => {
    expect(file.national_helpline.number).toBe("14555");
    expect(referenceText).toContain("AB PMJAY : 14555");
  });
});

describe("buildFinancialAnswer", () => {
  const facts = new Set(allFacts().map((f) => f.text));
  const answer = (text: string) => {
    const route = routePracticalQuestion(text);
    if (!route || route.kind !== "pay") throw new Error(`not a pay question: ${text}`);
    return buildFinancialAnswer(route);
  };

  it.each([
    "Does Ayushman Bharat cover cancer treatment?",
    "Ayushman card kaise banwayein? Papa ko cancer hai",
    "Is there a government scheme in Tamil Nadu for cancer treatment?",
    "Do cancer patients get a concession on train tickets?",
    "How to apply to the Prime Minister's relief fund for my mother's cancer treatment?",
    "Is there a government scheme in Maharashtra for cancer?",
  ])("states only facts from the file, with the checked-on date: %s", (text) => {
    const reply = answer(text);
    expect(reply.startsWith("Here is what Suchi has on record, with the page each part comes from.")).toBe(true);
    expect(reply).toContain("Checked on 25 November 2026. Rules change");
    for (const line of reply.split("\n").filter((l) => l.startsWith("- "))) {
      expect({ line, inFile: facts.has(line.slice(2)) }).toEqual({ line, inFile: true });
    }
  });

  it("names the papers the official FAQ asks for, and none of the old fixed list", () => {
    const reply = answer("Ayushman card kaise banwayein? Papa ko cancer hai");
    expect(reply).toContain("carry a ration card or any government photo ID such as Aadhaar");
    expect(reply).not.toMatch(/tehsildar|four photographs|Passport-size|Bank account|cancer diagnosis certificate/i);
  });

  it("answers a state question with that state's scheme, page and helpline, then PM-JAY", () => {
    const reply = answer("Is there a government scheme in Tamil Nadu for cancer treatment?");
    expect(reply).toContain("Chief Minister's Comprehensive Health Insurance Scheme (CMCHIS)");
    expect(reply).toContain("Source page: https://www.cmchistn.com/");
    expect(reply).toContain("1800 425 3993");
    expect(reply.indexOf("**Tamil Nadu**")).toBeLessThan(reply.indexOf("**Ayushman Bharat PM-JAY**"));
  });

  it("never falls back to another state's content", () => {
    for (const text of [
      "Is there a government scheme in Tamil Nadu for cancer treatment?",
      "Is there a Kerala scheme for cancer patients' treatment costs?",
      "Is there a government scheme in Maharashtra for cancer?",
    ]) {
      const reply = answer(text);
      expect(reply).not.toMatch(/Bihar|BISWASS|Patna/);
    }
  });

  it("says plainly when a state is not covered and gives the national helpline", () => {
    const reply = answer("Is there a government scheme in Maharashtra for cancer?");
    expect(reply).toContain("Suchi does not yet have confirmed information about a state scheme in Maharashtra.");
    expect(reply).toContain("The PM-JAY toll-free helpline is 14555.");
  });

  it("answers the senior citizen card question from the senior citizen FAQ", () => {
    const reply = answer("My father is 72. Is there a new Ayushman card for senior citizens?");
    expect(reply).toContain("Everyone aged 70 or over can get the Ayushman Vay Vandana card");
    expect(reply).toContain("1800110770");
  });

  it("says what it could not confirm instead of guessing", () => {
    expect(answer("Do cancer patients get a concession on train tickets?")).toContain(
      "Suchi could not confirm who must sign the certificate for a cancer patient."
    );
    expect(answer("What is Rashtriya Arogya Nidhi and how do I apply?")).toContain(
      "Suchi could not confirm the income limit or the amounts of the Discretionary Grant"
    );
  });

  it("is deterministic", () => {
    const q = "Does Ayushman Bharat cover cancer treatment?";
    expect(answer(q)).toBe(answer(q));
  });
});

describe("practicalUnknownReply", () => {
  it("says Suchi has no confirmed information and points to the official helpline and site", () => {
    const reply = practicalUnknownReply();
    expect(reply.startsWith("Suchi does not have confirmed information on that yet.")).toBe(true);
    expect(reply).toContain("14555");
    expect(reply).toContain("https://nha.gov.in/");
  });

  it("does not use the medical abstention wording", () => {
    const reply = practicalUnknownReply();
    expect(reply).not.toMatch(/NCI|clinician|doctor|healthcare provider/i);
  });
});
