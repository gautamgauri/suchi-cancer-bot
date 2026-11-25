/**
 * Onco Talks episodes that may be posted, with only their recorded metadata.
 *
 * Copied from apps/landing/src/content/videos.json (the API image does not
 * contain apps/landing). onco-talks.spec.ts checks every field against that
 * file, so a change there fails the test until this list follows.
 *
 * Only the title, the audience tags and the page link are used in posts. The
 * `takeaways` in videos.json are clinical statements that no clinician has
 * reviewed, so they are left out here and never paraphrased.
 *
 * The YouTube titles were read from YouTube's oEmbed endpoint on 25 November
 * 2026 and match the uploads on SCCF's channel.
 *
 * Panel discussions and conference recordings are excluded. They are talks
 * between doctors about named drugs, and their audience tags in videos.json
 * (patients, caregivers) look wrong for a family audience. They need a
 * clinician's view before any post points families to them.
 */
import { ContentBrief, SourceFact } from "../social.types";
import { SITE_URL } from "../links";

export interface OncoTalksEpisode {
  slug: string;
  youtubeId: string;
  /** Title as recorded in videos.json. */
  title: string;
  /** Title of the upload on YouTube. */
  youtubeTitle: string;
  playlist: "onco-talks";
  whoIsThisFor: Array<"patients" | "caregivers" | "general">;
  /** Plain words for the subject, taken from the title. */
  subject: string;
}

export const ONCO_TALKS: OncoTalksEpisode[] = [
  { slug: "onco-talks-episode-1-oral-cancer", youtubeId: "AmWyqSkCuqE", title: "Onco Talks Episode 1: Oral Cancer", youtubeTitle: "OncoTalks by Suchitra Cancer Care - Episode 1 Oral Cancer", playlist: "onco-talks", whoIsThisFor: ["patients", "caregivers", "general"], subject: "oral cancer" },
  { slug: "onco-talks-episode-2-prostate-cancer", youtubeId: "N8CmiHcXcok", title: "Onco Talks Episode 2: Prostate Cancer", youtubeTitle: "Onco Talks by Suchitra Cancer Care Foundation- Episode-2 [Prostate Cancer]", playlist: "onco-talks", whoIsThisFor: ["patients", "caregivers", "general"], subject: "prostate cancer" },
  { slug: "onco-talks-episode-3-cancer-surgery", youtubeId: "ModQvH5WTXk", title: "Onco Talks Episode 3: Cancer Surgery", youtubeTitle: "Onco Talks by Suchitra Cancer Care Foundation Episode 3- \"Cancer Surgery\"", playlist: "onco-talks", whoIsThisFor: ["patients", "caregivers"], subject: "cancer surgery" },
  { slug: "onco-talks-episode-4-ovarian-cancer", youtubeId: "X3dCbyG-GnE", title: "Onco Talks Episode 4: Ovarian Cancer", youtubeTitle: "Onco Talks by Suchitra Cancer Care Foundation- Episode 4 [Ovarian Cancer]", playlist: "onco-talks", whoIsThisFor: ["patients", "caregivers", "general"], subject: "ovarian cancer" },
  { slug: "onco-talks-episode-5-childhood-cancer", youtubeId: "8dwnK_jiyUQ", title: "Onco Talks Episode 5: Childhood Cancer", youtubeTitle: "Onco Talks by Suchitra Cancer Care Foundation- Episode 5 \"Childhood Cancer\"", playlist: "onco-talks", whoIsThisFor: ["caregivers"], subject: "childhood cancer" },
  { slug: "onco-talks-episode-6-precision-oncology", youtubeId: "6edsfQY1TZU", title: "Onco Talks Episode 6: Precision Oncology", youtubeTitle: "Onco Talks by Suchitra Cancer Care Foundation-Episode 6 \"Precision Oncology\"", playlist: "onco-talks", whoIsThisFor: ["patients", "caregivers"], subject: "precision oncology" },
  { slug: "onco-talks-episode-7-bone-marrow-transplants", youtubeId: "8QbjErXl8DM", title: "Onco Talks Episode 7: Bone Marrow & Stem Cell Transplants", youtubeTitle: "Onco Talks by Suchitra Cancer Care Foundation - Episode 7 \"Bone Marrow & Stem Cell Transplants\"", playlist: "onco-talks", whoIsThisFor: ["patients", "caregivers"], subject: "bone marrow and stem cell transplants" },
  { slug: "onco-talks-episode-8-lung-head-neck", youtubeId: "3C0RUiaIuQQ", title: "Onco Talks Episode 8: Lung & Head and Neck Cancers", youtubeTitle: "Onco Talks By Suchitra Cancer Care Foundation- Episode 8 \"Understanding Lung & Head & Neck Cancers\"", playlist: "onco-talks", whoIsThisFor: ["patients", "caregivers", "general"], subject: "lung cancer and head and neck cancers" },
];

const AUDIENCE_WORDS: Record<string, string> = {
  patients: "patients",
  caregivers: "caregivers",
  general: "the general public",
};

export function watchPath(ep: OncoTalksEpisode): string {
  return `/watch/${ep.slug}/`;
}

export function episodeNumber(ep: OncoTalksEpisode): number {
  const m = /Episode (\d+)/.exec(ep.title);
  if (!m) throw new Error(`No episode number in ${ep.title}`);
  return Number(m[1]);
}

/** The facts a post about this episode may use, all from its recorded metadata. */
export function episodeFacts(ep: OncoTalksEpisode, fetchedOn = "2026-11-25"): SourceFact[] {
  const page = `${SITE_URL}${watchPath(ep)}`;
  const audience = ep.whoIsThisFor.map((w) => AUDIENCE_WORDS[w]);
  return [
    { text: `${ep.title}. This episode of SCCF's Onco Talks video series is about ${ep.subject}.`, url: page, fetchedOn },
    { text: `The episode is listed for ${audience.join(" and ")}.`, url: page, fetchedOn },
    { text: `On YouTube the upload is titled "${ep.youtubeTitle}".`, url: `https://www.youtube.com/@suchitracancercarefoundati1877`, fetchedOn },
  ];
}

export function episodeBrief(ep: OncoTalksEpisode): ContentBrief {
  const n = episodeNumber(ep);
  return {
    topicId: `onco-talks-${n}`,
    lane: "onco_talks",
    title: ep.title,
    angle: `Point people to episode ${n} of Onco Talks. Say plainly that it is about ${ep.subject} and who it is meant for. Do not describe what is said in it.`,
    facts: episodeFacts(ep),
    sitePath: watchPath(ep),
    nextStep: "site",
    allowedTerms: [ep.subject, ep.title, "oncologist", "oncologists"],
  };
}

export function findEpisode(n: number): OncoTalksEpisode {
  const ep = ONCO_TALKS.find((e) => episodeNumber(e) === n);
  if (!ep) throw new Error(`No Onco Talks episode ${n}`);
  return ep;
}
