import { readFileSync } from "fs";
import { join } from "path";
import { ONCO_TALKS, episodeBrief, episodeFacts } from "./onco-talks";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..");

interface Video { slug: string; youtubeId: string; title: string; playlist: string; whoIsThisFor: string[] }

describe("Onco Talks metadata", () => {
  const videos: Video[] = JSON.parse(readFileSync(join(REPO_ROOT, "apps/landing/src/content/videos.json"), "utf8")).videos;

  it("matches apps/landing/src/content/videos.json field for field", () => {
    for (const ep of ONCO_TALKS) {
      const v = videos.find((x) => x.slug === ep.slug);
      expect(v).toBeDefined();
      expect({ youtubeId: ep.youtubeId, title: ep.title, playlist: ep.playlist, whoIsThisFor: ep.whoIsThisFor })
        .toEqual({ youtubeId: v!.youtubeId, title: v!.title, playlist: v!.playlist, whoIsThisFor: v!.whoIsThisFor });
    }
  });

  it("covers every Onco Talks episode in the site list", () => {
    const site = videos.filter((v) => v.playlist === "onco-talks").map((v) => v.slug).sort();
    expect(ONCO_TALKS.map((e) => e.slug).sort()).toEqual(site);
  });

  it("never uses the unreviewed clinical takeaways", () => {
    for (const ep of ONCO_TALKS) {
      const text = episodeFacts(ep).map((f) => f.text).join(" ");
      const v = videos.find((x) => x.slug === ep.slug) as Video & { takeaways?: string[] };
      for (const t of v.takeaways ?? []) expect(text).not.toContain(t);
    }
  });

  it("builds a brief in the Onco Talks lane pointing at the watch page", () => {
    const b = episodeBrief(ONCO_TALKS[0]);
    expect(b.lane).toBe("onco_talks");
    expect(b.sitePath).toBe("/watch/onco-talks-episode-1-oral-cancer/");
    expect(b.nextStep).toBe("site");
  });
});
