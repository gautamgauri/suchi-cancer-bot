/* eslint-disable no-console */
import fs from "fs";
import path from "path";

type WHOIngestionRecord = {
  id: string;
  page_url?: string | null;
  pdf_url?: string | null;
  local_pdf_path: string;
  markdown_path: string | null;
  title: string;
  year?: number | null;
  source?: string;
  source_type: string;
  language?: string;
  license?: string;
  citation?: string;
  topics?: string[];
  cancer_types?: string[];
  audience_level?: "patient" | "caregiver" | "general" | "technical";
  status?: "active" | "inactive" | "deprecated";
  publication_date?: string | null; // YYYY-MM-DD
};

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

type CliOpts = {
  inputPath: string;
  outputPath: string;
  kbRoot: string;
};

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  const get = (k: string, def?: string) => {
    const i = args.indexOf(k);
    return i === -1 ? def : args[i + 1];
  };

  const inputPath = get("--input", "kb/who_ingestion_records.json");
  const outputPath = get("--output", "kb/who_manifest_snippet.json");
  const kbRoot = get("--kbRoot", "kb");

  if (!inputPath) {
    throw new Error("--input <path> is required");
  }

  return {
    inputPath,
    outputPath: outputPath!,
    kbRoot: kbRoot!,
  };
}

function mustExist(p: string): void {
  if (!fs.existsSync(p)) {
    throw new Error(`Missing file: ${p}`);
  }
}

function loadRecords(p: string): WHOIngestionRecord[] {
  const raw = fs.readFileSync(p, "utf8");
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data as WHOIngestionRecord[];
  if (Array.isArray(data.records)) return data.records as WHOIngestionRecord[];
  throw new Error("Input must be an array or an object with a `records` array.");
}

function toManifestDoc(
  rec: WHOIngestionRecord,
  kbRoot: string
): ManifestDoc {
  if (!rec.markdown_path) {
    throw new Error(`Record ${rec.id} is missing markdown_path`);
  }

  // Normalize path to be relative to kb root (no leading "kb/")
  let relPath = rec.markdown_path.replace(/\\/g, "/");
  const kbPrefix = kbRoot.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  if (relPath.startsWith(kbPrefix)) {
    relPath = relPath.substring(kbPrefix.length);
  } else if (relPath.startsWith("kb/")) {
    relPath = relPath.substring("kb/".length);
  }

  const version =
    typeof rec.year === "number" && Number.isFinite(rec.year)
      ? String(rec.year)
      : "v1";

  const status: ManifestDoc["status"] = rec.status ?? "active";
  const source = rec.source ?? "World Health Organization";
  const sourceType = rec.source_type || "03_who_public_health";

  const language = rec.language ?? "en";
  const audienceLevel = rec.audience_level ?? "patient";
  const cancerTypes = rec.cancer_types ?? [];
  const tags = rec.topics ?? [];

  const url = rec.page_url ?? rec.pdf_url ?? null;
  const lastReviewed = rec.publication_date ?? undefined;

  // Default WHO docs to "as_needed" review; can be adjusted later per-doc
  const reviewFrequency: ManifestDoc["reviewFrequency"] = "as_needed";

  return {
    id: rec.id,
    title: rec.title,
    version,
    status,
    source,
    sourceType,
    path: relPath,
    license: rec.license,
    lastReviewed,
    reviewFrequency,
    audienceLevel,
    language,
    cancerTypes,
    tags,
    url,
    citation: rec.citation ?? null,
  };
}

async function main() {
  const { inputPath, outputPath, kbRoot } = parseArgs();

  mustExist(inputPath);

  const records = loadRecords(inputPath);
  if (records.length === 0) {
    console.log("No WHO ingestion records found; nothing to do.");
    return;
  }

  const docs: ManifestDoc[] = records.map((r) => toManifestDoc(r, kbRoot));

  const dir = path.dirname(outputPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    outputPath,
    JSON.stringify({ docs }, null, 2),
    "utf8"
  );

  console.log(
    `Wrote WHO manifest snippet with ${docs.length} docs to ${outputPath}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

