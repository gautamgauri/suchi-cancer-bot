import { CALENDAR } from "./calendar";
import { gateDraft, describeViolations } from "../voice/draft-gate";
import { lintProse } from "../voice/voice-lint";
import { PLATFORMS } from "../social.types";
import { carriesPlatformCode } from "../links";

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
