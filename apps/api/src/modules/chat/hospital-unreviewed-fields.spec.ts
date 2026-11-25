import { ChatService } from "./chat.service";
import { PlanExecutorService } from "./plan-executor.service";
import {
  HospitalDirectoryService,
  HospitalSearchResult,
  buildBotPool,
  compareForRequest,
  toBotHospital,
} from "./hospital-directory.service";
import { WhatsAppNavigatorFlowService } from "../whatsapp-navigator/whatsapp-navigator-flow.service";
import { readHospitalDirectoryFile } from "../../common/hospital-directory-file";
import { isBotVisible, RawHospitalEntry } from "../../common/hospital-visibility";

/**
 * The bot must not pass to the model, or show to a user, any directory field
 * that has not been reviewed for publication: notes, navigation notes, SCCF
 * notes, risk-flag text, anything from key_doctors, the cost tier, the tier
 * letter or the score.
 *
 * Every assertion reads its forbidden strings from the shipped directory at
 * test time, so no note, flag or name is copied into this file, and the test
 * fails if a formatter starts printing one of those fields again.
 */

type Raw = RawHospitalEntry & Record<string, any>;
const RAWS = readHospitalDirectoryFile().hospitals as Raw[];

/** A probe long enough not to collide with a name, city or department. */
const probe = (text: unknown): string | null => {
  if (typeof text !== "string") return null;
  const t = text.trim();
  return t.length >= 16 ? t.slice(0, 40) : null;
};

const DOCTOR_IN_TEXT = /\bDr\.?\s?(?:[A-Z][A-Za-z]*\.?\s?){1,4}/g;

/** Strings from this entry that must never appear in anything the bot produces. */
function forbidden(h: Raw): string[] {
  const out: string[] = [];
  const add = (t: unknown) => {
    const p = probe(t);
    if (p) out.push(p);
  };
  add(h.notes);
  add(h.sccf_notes);
  add(h.risk_flag);
  for (const n of (h.navigation_notes as unknown[]) ?? []) add(n);
  for (const d of (h.key_doctors as Array<{ name?: string } | string>) ?? []) {
    const name = typeof d === "string" ? d : d?.name;
    if (typeof name === "string" && name.trim().length >= 6 && !String(h.name).includes(name.trim())) out.push(name.trim());
  }
  for (const m of String(h.notes ?? "").matchAll(DOCTOR_IN_TEXT)) {
    const name = m[0].trim();
    if (name.length >= 6 && !String(h.name).includes(name)) out.push(name);
  }
  return out;
}

/** Labels that only the removed fields produced. */
const FORBIDDEN_LABELS = [/Cost:/, /\(Tier [A-D]\)/, /\bscore\b/i, /Notes:/, /Navigation:/, /Free \/ PMJAY accepted/];

function expectClean(text: string, h: Raw, where: string): void {
  for (const f of forbidden(h)) {
    if (text.includes(f)) throw new Error(`${where}: shows an unreviewed field of ${h.id}`);
  }
  for (const re of FORBIDDEN_LABELS) {
    if (re.test(text)) throw new Error(`${where}: shows a removed label (${re}) for ${h.id}`);
  }
}

describe("hospital directory: unreviewed fields never reach the model or a user", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chat: any = Object.create(ChatService.prototype);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executor: any = Object.create(PlanExecutorService.prototype);
  const geography = { stage: "city" as const, requestedCity: "Patna", resolvedState: "Bihar" };

  it("covers every entry in the shipped directory, including the two whose notes name a doctor", () => {
    expect(RAWS.length).toBeGreaterThanOrEqual(80);
    const withDoctorInNotes = RAWS.filter((h) => [...String(h.notes ?? "").matchAll(DOCTOR_IN_TEXT)].length > 0);
    expect(withDoctorInNotes.length).toBeGreaterThanOrEqual(2);
  });

  it("the sanitised record holds none of the removed fields", () => {
    for (const raw of RAWS) {
      const bot = toBotHospital(raw) as unknown as Record<string, unknown>;
      for (const key of ["notes", "navigation_notes", "sccf_notes", "risk_flag", "key_doctors", "cost_tier", "cost_ranges", "tier", "score", "score_breakdown"]) {
        expect(key in bot).toBe(false);
      }
      expectClean(JSON.stringify(bot), raw, "toBotHospital");
    }
  });

  it("the model's hospital block is clean for every entry, sanitised or raw", () => {
    for (const raw of RAWS) {
      const viaPool = chat.buildHospitalContextBlock([toBotHospital(raw)], geography) as string;
      expectClean(viaPool, raw, "model prompt");
      // Even a raw record handed straight to the formatter prints nothing extra.
      const direct = chat.buildHospitalContextBlock([raw as unknown as HospitalSearchResult], geography) as string;
      expectClean(direct, raw, "model prompt (raw record)");
      expect(direct).not.toContain("VERIFIED");
      expect(direct).not.toContain("verified entries");
    }
  });

  it("the deterministic template reply is clean for every entry, sanitised or raw", () => {
    for (const raw of RAWS) {
      for (const h of [toBotHospital(raw), raw as unknown as HospitalSearchResult]) {
        const text = executor.renderHospitalDirectorySection([h], geography, 3) as string;
        expectClean(text, raw, "template reply");
      }
    }
  });

  it("the legacy WhatsApp navigator card is clean for every entry", () => {
    const nav = new WhatsAppNavigatorFlowService();
    for (const raw of RAWS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const card = (nav as any).formatHospitalCard(1, raw) as string;
      expectClean(card, raw, "navigator card");
      expect(card).not.toMatch(/Recommended/i);
    }
  });

  it("the legacy navigator result never says 'Recommended' and only lists visible entries", () => {
    const nav = new WhatsAppNavigatorFlowService();
    nav.onModuleInit();
    const visible = new Set(RAWS.filter(isBotVisible).map((h) => h.id));
    const names = new Map(RAWS.map((h) => [String(h.short_name || h.name), h]));
    for (const state of ["1", "2", "3", "4", "5"]) {
      for (const cancer of ["1", "2", "3", "4", "5", "6", "7"]) {
        for (const budget of ["1", "2", "3"]) {
          let session: any = { phone: "x", step: "start", updatedAt: new Date() };
          for (const input of ["hi", state, cancer, budget]) {
            const r = nav.processMessage(session, input);
            session = r.updatedSession;
            if (input === budget) {
              const text = r.response.text;
              expect(text).not.toMatch(/Recommended/i);
              for (const [name, h] of names) {
                if (text.includes(`. ${name}\n`)) {
                  expect(visible.has(h.id)).toBe(true);
                  expectClean(text, h, "navigator result");
                }
              }
            }
          }
        }
      }
    }
  });
});

describe("hospital directory: the bot's pool follows the site's exclusions", () => {
  const svc = new HospitalDirectoryService();
  beforeAll(() => svc.onModuleInit());

  const excluded = RAWS.filter((h) => !isBotVisible(h));

  it("excludes inactive, flagged and held entries", () => {
    expect(excluded.length).toBeGreaterThan(0);
    for (const h of excluded) expect(svc.getHospitalById(h.id)).toBeNull();
  });

  it("never returns an excluded entry for any city or state in the directory", () => {
    const ids = new Set(excluded.map((h) => h.id));
    const places = new Set<string>();
    for (const h of RAWS) {
      places.add(`city:${h.city}`);
      places.add(`state:${h.state}`);
    }
    for (const place of places) {
      const [kind, value] = place.split(":");
      for (const pmjayRequired of [false, true]) {
        for (const affordabilityTier of ["any", "low", "medium"] as const) {
          const results = svc.searchHospitals({
            ...(kind === "city" ? { city: value } : { state: value }),
            maxResults: 50,
            pmjayRequired,
            affordabilityTier,
          });
          for (const r of results) expect(ids.has(r.id)).toBe(false);
        }
      }
    }
  });
});

describe("hospital directory: ranking does not depend on score or cost tier", () => {
  it("gives the same order whatever the score and cost tier say", () => {
    const visible = RAWS.filter(isBotVisible);
    const base = buildBotPool(visible).regional;
    const scrambled = buildBotPool(
      visible.map((h, i) => ({ ...h, score: (i * 37) % 101, cost_tier: ["Low", "High", "Medium"][i % 3] })),
    ).regional;
    for (const [city, state, stage] of [
      ["Patna", "Bihar", "city"],
      [null, "Bihar", "state"],
      ["Darbhanga", "Bihar", "distance"],
      [null, null, "none"],
    ] as const) {
      const cmp = compareForRequest(city, state, stage);
      expect([...scrambled].sort(cmp).map((h) => h.id)).toEqual([...base].sort(cmp).map((h) => h.id));
    }
  });

  it("puts the requested city first, then orders by name", () => {
    const pool = buildBotPool(RAWS).regional;
    const sorted = [...pool].sort(compareForRequest("Patna", "Bihar", "city"));
    const firstOther = sorted.findIndex((h) => h.city !== "Patna");
    expect(firstOther).toBeGreaterThan(0);
    expect(sorted.slice(0, firstOther).every((h) => h.city === "Patna")).toBe(true);
    const patna = sorted.slice(0, firstOther).map((h) => h.name);
    expect(patna).toEqual([...patna].sort((a, b) => a.localeCompare(b, "en")));
  });
});
