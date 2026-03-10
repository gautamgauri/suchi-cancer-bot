/* eslint-disable no-console */
import fs from "fs";
import path from "path";

type ManifestDoc = {
  id: string;
  title: string;
  version: string;
  status?: "active" | "inactive" | "deprecated";
  source?: string;
  sourceType?: string;
  path: string;
  license?: string;
  lastReviewed?: string;
  reviewFrequency?: "quarterly" | "annual" | "monthly" | "as_needed";
  audienceLevel?: "patient" | "caregiver" | "general" | "technical";
  language?: string;
  cancerTypes?: string[];
  tags?: string[];
  url?: string | null;
  citation?: string | null;
};

type Manifest = {
  locale?: string;
  schemaVersion?: string;
  docs: ManifestDoc[];
};

type CliOpts = {
  manifestPath: string;
  snippetPath: string;
  dryRun: boolean;
  backup: boolean;
};

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  const get = (k: string, def?: string) => {
    const i = args.indexOf(k);
    return i === -1 ? def : args[i + 1];
  };
  const flag = (k: string) => args.includes(k);

  const manifestPath = get("--manifest", "kb/manifest.json");
  const snippetPath = get("--snippet");

  if (!snippetPath) {
    throw new Error("--snippet <path> is required");
  }

  return {
    manifestPath: manifestPath!,
    snippetPath,
    dryRun: flag("--dryRun"),
    backup: !flag("--noBackup"),
  };
}

function mustExist(p: string): void {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing file: ${p}`);
  }
}

function loadJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function normalizeSnippet(snippetRaw: any): ManifestDoc[] {
  if (Array.isArray(snippetRaw)) return snippetRaw as ManifestDoc[];
  if (snippetRaw && Array.isArray(snippetRaw.docs)) {
    return snippetRaw.docs as ManifestDoc[];
  }
  throw new Error("Snippet must be an array or an object with a `docs` array.");
}

function validateDocs(docs: ManifestDoc[]): void {
  for (const d of docs) {
    if (!d.id || !d.title || !d.path || !d.sourceType) {
      throw new Error(
        `Invalid doc ${d.id ?? "<missing id>"}: id/title/path/sourceType are required`
      );
    }
    if (d.sourceType !== "03_who_public_health") {
      console.warn(
        `⚠️ Doc ${d.id} has sourceType=${d.sourceType}, expected 03_who_public_health (check this is intentional)`
      );
    }
  }
}

function mergeDocs(main: ManifestDoc[], snippet: ManifestDoc[]) {
  const snippetIds = new Set(snippet.map((d) => d.id));
  const kept = main.filter((d) => !snippetIds.has(d.id));
  const replacedCount = main.length - kept.length;
  const merged = kept.concat(snippet).sort((a, b) => a.id.localeCompare(b.id));
  return { merged, replacedCount };
}

function backupFile(p: string): string {
  const backupPath = path.join(
    path.dirname(p),
    path.basename(p).replace(/\.json$/, ".backup.json")
  );
  fs.copyFileSync(p, backupPath);
  return backupPath;
}

async function main() {
  const { manifestPath, snippetPath, dryRun, backup } = parseArgs();

  mustExist(manifestPath);
  mustExist(snippetPath);

  const manifest = loadJson<Manifest>(manifestPath);
  if (!Array.isArray(manifest.docs)) {
    throw new Error(`Manifest at ${manifestPath} has no 'docs' array`);
  }

  const snippetRaw = loadJson<any>(snippetPath);
  const snippetDocs = normalizeSnippet(snippetRaw);
  validateDocs(snippetDocs);

  const originalCount = manifest.docs.length;
  const { merged, replacedCount } = mergeDocs(manifest.docs, snippetDocs);
  const addedCount = snippetDocs.length - replacedCount;

  console.log(`Existing docs: ${originalCount}`);
  console.log(`Snippet docs: ${snippetDocs.length}`);
  console.log(`Will replace: ${replacedCount}`);
  console.log(`Will add: ${addedCount}`);
  console.log(`Total after merge: ${merged.length}`);

  if (dryRun) {
    console.log("Dry run only; no files written.");
    return;
  }

  if (backup) {
    const backupPath = backupFile(manifestPath);
    console.log(`Backup written to ${backupPath}`);
  }

  manifest.docs = merged;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Updated manifest written to ${manifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

