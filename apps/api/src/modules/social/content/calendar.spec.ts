import { CALENDAR } from "./calendar";
import { gateDraft, describeViolations } from "../voice/draft-gate";
import { lintProse } from "../voice/voice-lint";
import { PLATFORMS } from "../social.types";
import { carriesPlatformCode } from "../links";
import { GENERIC_CARD } from "../social.service";
import { readFileSync } from "fs";
import { join } from "path";

/** Width and height from a baseline JPEG's SOF0 marker. Throws if the bytes are not a JPEG. */
function jpegSize(buf: Buffer): { width: number; height: number } {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error("bad marker");
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("no size found");
}

describe("four-week calendar", () => {
  it("has twelve items, three a week, in the two safe lanes only", () => {
    expect(CALENDAR).toHaveLength(12);
    for (const item of CALENDAR) expect(["practical", "onco_talks"]).toContain(item.brief.lane);
    const dates = CALENDAR.map((i) => i.date);
    expect(new Set(dates).size).toBe(12);
    expect([...dates].sort()).toEqual(dates);
  });

  it("gives every item a card whose text passes the owner's prose rules", () => {
    for (const item of CALENDAR) {
      expect(item.card.file).toMatch(/^[a-z0-9-]+\.jpg$/);
      expect(lintProse(item.card.text)).toEqual([]);
      expect(item.card.text.length).toBeLessThanOrEqual(120);
    }
  });

  it("records an official source URL and fetch date for every fact", () => {
    for (const item of CALENDAR) {
      expect(item.brief.facts.length).toBeGreaterThan(0);
      for (const f of item.brief.facts) {
        expect(f.url).toMatch(/^https:\/\//);
        expect(f.fetchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("has a card JPEG for every item, within Instagram's size and shape limits", () => {
    const dir = join(__dirname, "..", "..", "..", "..", "..", "landing", "public", "social", "cards");
    for (const file of [...CALENDAR.map((i) => i.card.file), GENERIC_CARD.file]) {
      const buf = readFileSync(join(dir, file));
      expect(buf.length).toBeLessThan(8 * 1024 * 1024);
      const { width, height } = jpegSize(buf);
      expect(width).toBeGreaterThanOrEqual(320);
      expect(width).toBeLessThanOrEqual(1440);
      const ratio = width / height;
      expect(ratio).toBeGreaterThanOrEqual(0.8);
      expect(ratio).toBeLessThanOrEqual(1.91);
    }
  });

  const drafted = CALENDAR.filter((i) => i.drafts);
  it("hand-writes the first six items for all four platforms", () => {
    expect(drafted).toHaveLength(6);
  });

  for (const item of drafted) {
    for (const platform of PLATFORMS) {
      it(`${item.brief.topicId} on ${platform} passes the voice gate`, () => {
        const d = item.drafts![platform];
        const result = gateDraft(platform, d.text, item.brief, d.cardText);
        if (!result.passed) throw new Error(describeViolations(result.violations).join("\n"));
        expect(result.score.total).toBeGreaterThanOrEqual(75);
      });
    }

    it(`${item.brief.topicId} uses the calendar card on Instagram`, () => {
      expect(item.drafts!.instagram.cardText).toBe(item.card.text);
      expect(item.drafts!.instagram.imageUrl).toBe(`https://suchitracancercare.org/social/cards/${item.card.file}`);
    });

    it(`${item.brief.topicId} links each web platform with its own code`, () => {
      for (const p of ["linkedin", "facebook", "x"] as const) {
        const urls = item.drafts![p].text.match(/https?:\/\/\S+/g) ?? [];
        expect(carriesPlatformCode(urls[urls.length - 1], p)).toBe(true);
      }
    });
  }
});
