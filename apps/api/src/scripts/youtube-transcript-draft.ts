/* eslint-disable no-console */
/**
 * Regenerate the OncoTalk transcript KB drafts from `curation.json`.
 *
 * This is an OFFLINE, LOCAL tool. It writes reviewable markdown into a repo
 * checkout so the result goes through a pull request. It does NOT touch the
 * database — no chunks, no embeddings, no `KbDocument` rows. Ingest is a
 * separate, deliberate step that must wait on the decisions in issue #91 §7.
 *
 * Usage (from apps/api):
 *   npx ts-node src/scripts/youtube-transcript-draft.ts \
 *     --curation ../../scripts/youtube-transcripts/curation.json \
 *     --kbRoot ../../kb \
 *     --manifest ../../kb/manifest.oncotalks-pending.json
 *
 * Optional: --only <videoId>   regenerate a single video
 *           --check            fail if the regenerated output differs from
 *                              what is committed (drift check for CI)
 */
import fs from "fs";
import path from "path";
import { YoutubeService } from "../modules/youtube/youtube.service";
import { KbService, KbDocument, CurationOverrides } from "../modules/youtube/kb.service";

type Decision = "include" | "exclude";

interface CuratedVideo extends CurationOverrides {
  videoId: string;
  decision: Decision;
  /** Why this video is or is not in the KB. Required for both decisions. */
  reason: string;
  playlist?: string;
  language?: string;
}

interface CurationFile {
  channelId: string;
  channelUrl: string;
  reviewedBy?: string;
  reviewedOn?: string;
  videos: CuratedVideo[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const curationPath = path.resolve(
    arg("curation") || path.join(process.cwd(), "../../scripts/youtube-transcripts/curation.json"),
  );
  const kbRoot = path.resolve(arg("kbRoot") || path.join(process.cwd(), "../../kb"));
  const manifestPath = path.resolve(arg("manifest") || path.join(kbRoot, "manifest.oncotalks-pending.json"));
  const only = arg("only");
  const check = flag("check");

  if (!fs.existsSync(curationPath)) throw new Error(`Missing curation file: ${curationPath}`);
  const curation: CurationFile = JSON.parse(fs.readFileSync(curationPath, "utf-8"));

  process.env.KB_ROOT = kbRoot;

  const youtube = new YoutubeService();
  const kb = new KbService();
  kb.resolveKbRoot(); // fail fast if this is not a real KB checkout

  const included = curation.videos.filter((v) => v.decision === "include" && (!only || v.videoId === only));
  const excluded = curation.videos.filter((v) => v.decision === "exclude");

  console.log(`Curation: ${curation.videos.length} videos — ${included.length} to build, ${excluded.length} excluded`);

  const entries: KbDocument[] = [];
  const drift: string[] = [];

  for (const video of included) {
    console.log(`\n▶ ${video.videoId} — ${video.title ?? "(untitled)"}`);
    const transcript = await youtube.getVideoTranscript(video.videoId, video.language);
    youtube.assertUsable(transcript);

    if (video.language && transcript.language !== video.language) {
      throw new Error(
        `${video.videoId}: curation says language "${video.language}" but the original caption track is ` +
          `"${transcript.captionTrack}". Refusing to write a document whose stated language is wrong.`,
      );
    }

    const target = path.join(
      kbRoot,
      transcript.language,
      "01_suchi_oncotalks",
      `${(video.slug ?? video.title ?? transcript.title)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .substring(0, 50)
        .replace(/-+$/, "")}-${video.videoId}.md`,
    );
    const before = fs.existsSync(target) ? fs.readFileSync(target, "utf-8") : null;

    const { path: written, manifestEntry } = await kb.saveToKb(transcript, video);
    entries.push(manifestEntry);

    const after = fs.readFileSync(written, "utf-8");
    if (check) {
      if (before !== null && before !== after) drift.push(written);
      // --check is read-only: put back exactly what was committed so a drift
      // run never leaves the working tree (or CI checkout) modified.
      if (before !== null) fs.writeFileSync(written, before, "utf-8");
      else fs.rmSync(written);
    }
    console.log(`  ✓ ${path.relative(kbRoot, written)} (${after.length} chars)`);
  }

  if (check) {
    if (drift.length > 0) {
      console.error(`\n✗ Regenerated output differs from what is committed:\n  ${drift.join("\n  ")}`);
      process.exitCode = 1;
      return;
    }
    console.log("\n✓ Committed drafts match a fresh regeneration");
    return;
  }

  // Staged manifest ONLY. `npm run kb:ingest` reads kb/manifest.json and would
  // otherwise embed uncorrected machine transcripts on the next routine run.
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        locale: "multi",
        schemaVersion: "2.0",
        staged: true,
        note:
          "STAGED — NOT INGESTED. These are uncorrected machine transcripts awaiting SCCF medical review " +
          "(issue #91 D1-D5) and the KB duplicate cleanup (issue #86). ingest-kb.ts reads kb/manifest.json, " +
          "not this file, so nothing here is picked up by `npm run kb:ingest`.",
        docs: entries,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  console.log(`\n✓ Wrote ${entries.length} staged manifest entries to ${path.relative(process.cwd(), manifestPath)}`);

  if (excluded.length > 0) {
    const byReason = new Map<string, string[]>();
    for (const v of excluded) {
      const key = v.reason.split(".")[0];
      byReason.set(key, [...(byReason.get(key) ?? []), v.videoId]);
    }
    console.log(`\nExcluded (${excluded.length}), by reason:`);
    for (const [reason, ids] of byReason) console.log(`  - ${ids.length}x ${reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
