#!/usr/bin/env ts-node
/**
 * NCI-to-Website Content Generator
 *
 * Reads NCI knowledge base articles for a given cancer type and uses
 * Gemini (Vertex AI) to synthesize a structured, safety-compliant
 * website page.
 *
 * Usage:
 *   npx ts-node scripts/content-generator/nci-to-website.ts --cancer breast
 *   npx ts-node scripts/content-generator/nci-to-website.ts --cancer breast --output kb/en/website/
 *   npx ts-node scripts/content-generator/nci-to-website.ts --cancer breast --dry-run
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestDoc {
  id: string;
  title: string;
  version: string;
  status: string;
  source: string;
  sourceType: string;
  path: string;
  license: string;
  lastReviewed: string;
  reviewFrequency: string;
  audienceLevel: string;
  language: string;
  cancerTypes: string[];
  tags: string[];
  url: string | null;
  citation: string;
}

interface Manifest {
  locale: string;
  schemaVersion: string;
  docs: ManifestDoc[];
}

interface ContentCategory {
  category: string;
  docs: ManifestDoc[];
  contents: string[];
}

interface StructuredPage {
  cancerType: string;
  displayName: string;
  whatIs: string;
  warningSignsSigns: string[];
  riskFactors: string[];
  diagnosis: string;
  treatmentOptions: string;
  stagesExplained: string;
  whenToSeekHelp: string;
  questionsToAsk: string[];
  sources: { title: string; url: string }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../..");
const KB_ROOT = path.join(REPO_ROOT, "kb");
const MANIFEST_PATH = path.join(KB_ROOT, "manifest.json");
const DEFAULT_OUTPUT_DIR = path.join(KB_ROOT, "en", "website");

const GEMINI_PROJECT = process.env.GCP_PROJECT || "gen-lang-client-0202543132";
const GEMINI_LOCATION = process.env.GCP_LOCATION || "us-central1";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const TIMEOUT_MS = 60_000;

/**
 * Content categories we try to populate. Each has keywords used to match
 * NCI file names and tags.
 */
const CATEGORY_MATCHERS: { category: string; keywords: string[] }[] = [
  { category: "overview", keywords: ["overview", "what-is", "introduction"] },
  { category: "symptoms", keywords: ["symptom", "sign"] },
  { category: "risk_factors", keywords: ["risk", "cause", "prevention"] },
  { category: "screening", keywords: ["screening", "detection"] },
  { category: "diagnosis", keywords: ["diagnosis", "diagnostic", "test"] },
  { category: "staging", keywords: ["stage", "staging"] },
  { category: "treatment", keywords: ["treatment", "therapy", "surgery", "chemotherapy", "radiation"] },
  { category: "coping", keywords: ["coping", "survivorship", "support"] },
  { category: "research", keywords: ["research", "clinical-trial", "study"] },
];

const MISSING = "{{MISSING_EVIDENCE}}";

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

function loadManifest(): Manifest {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
  return JSON.parse(raw) as Manifest;
}

/**
 * Find all NCI docs whose cancerTypes include the given type.
 * We only include docs from 02_nci_core sourceType.
 */
function findDocsForCancerType(manifest: Manifest, cancerType: string): ManifestDoc[] {
  const normalised = cancerType.toLowerCase().trim();
  return manifest.docs.filter(
    (d) =>
      d.sourceType === "02_nci_core" &&
      d.status === "active" &&
      d.cancerTypes.some((ct) => ct.toLowerCase() === normalised),
  );
}

/**
 * Classify docs into content categories based on file path and tags.
 * A doc can appear in multiple categories.
 */
function classifyDocs(docs: ManifestDoc[]): Map<string, ManifestDoc[]> {
  const buckets = new Map<string, ManifestDoc[]>();

  for (const matcher of CATEGORY_MATCHERS) {
    buckets.set(matcher.category, []);
  }
  buckets.set("other", []);

  for (const doc of docs) {
    let matched = false;
    const haystack = `${doc.path} ${doc.tags.join(" ")} ${doc.title}`.toLowerCase();

    for (const matcher of CATEGORY_MATCHERS) {
      if (matcher.keywords.some((kw) => haystack.includes(kw))) {
        buckets.get(matcher.category)!.push(doc);
        matched = true;
      }
    }
    if (!matched) {
      buckets.get("other")!.push(doc);
    }
  }

  return buckets;
}

/**
 * Read the markdown body of a KB file (stripping YAML front matter).
 */
function readKbContent(docPath: string): string {
  const fullPath = path.join(KB_ROOT, docPath);
  if (!fs.existsSync(fullPath)) {
    return "";
  }
  const raw = fs.readFileSync(fullPath, "utf-8");

  // Strip YAML front matter
  const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n/);
  const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw.trim();

  // Strip image markdown to keep token usage low
  return body.replace(/!\[.*?\]\(.*?\)/g, "").trim();
}

/**
 * Load content for a category, capping total characters to keep within
 * token budgets (roughly 4 chars per token).
 */
function loadCategoryContent(
  docs: ManifestDoc[],
  maxChars: number = 30_000,
): { contents: string[]; usedDocs: ManifestDoc[] } {
  const contents: string[] = [];
  const usedDocs: ManifestDoc[] = [];
  let totalChars = 0;

  for (const doc of docs) {
    const content = readKbContent(doc.path);
    if (!content) continue;
    if (totalChars + content.length > maxChars) continue;
    contents.push(`--- SOURCE: ${doc.title} (${doc.path}) ---\n${content}`);
    usedDocs.push(doc);
    totalChars += content.length;
  }

  return { contents, usedDocs };
}

// ---------------------------------------------------------------------------
// LLM call (Gemini via Vertex AI)
// ---------------------------------------------------------------------------

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  // Dynamic require to avoid compile-time dependency on @google-cloud/vertexai.
  // At runtime the package is resolved from apps/api/node_modules.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { VertexAI } = require("@google-cloud/vertexai") as { VertexAI: any };

  const vertexAI = new VertexAI({
    project: GEMINI_PROJECT,
    location: GEMINI_LOCATION,
  });

  const model = vertexAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4000,
      responseMimeType: "application/json",
    },
  });

  const geminiPromise = model.generateContent({
    contents: [
      { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
    ],
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("GEMINI_TIMEOUT")), TIMEOUT_MS);
  });

  const result = await Promise.race([geminiPromise, timeoutPromise]) as any;
  const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSynthesisPrompt(
  cancerType: string,
  displayName: string,
  categoryContents: Map<string, { contents: string[]; usedDocs: ManifestDoc[] }>,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a medical content writer for a cancer information website.
Your job is to synthesize NCI (National Cancer Institute) source material into a structured JSON object for a patient-facing web page.

STRICT RULES:
1. Every fact MUST come from the provided NCI source material. Do NOT add information not present in the sources.
2. Use plain, empathetic language at a 6th-grade reading level.
3. NEVER use diagnostic language like "you have" or "this means you have cancer".
4. NEVER include survival rates, prognosis percentages, or life expectancy numbers.
5. Always use uncertainty language: "may", "can", "some people experience", "your doctor can help determine".
6. If a section has no source material, return the exact string "${MISSING}" for that field.
7. For list fields (arrays), return an empty array [] if no source material exists.

Respond with a JSON object matching this exact schema:
{
  "cancerType": "${cancerType}",
  "displayName": "${displayName}",
  "whatIs": "2-3 sentence plain language explanation",
  "warningSignsSigns": ["symptom 1", "symptom 2", ...],
  "riskFactors": ["risk factor 1", "risk factor 2", ...],
  "diagnosis": "paragraph about how it is diagnosed",
  "treatmentOptions": "paragraph overview of treatment approaches",
  "stagesExplained": "plain language staging overview",
  "whenToSeekHelp": "specific symptoms and timeframes for seeking medical attention",
  "questionsToAsk": ["question 1", "question 2", ...],
  "sources": [{"title": "source title", "url": "https://..."}]
}`;

  // Build user prompt with all category content
  const sections: string[] = [];
  for (const [category, data] of categoryContents) {
    if (data.contents.length === 0) continue;
    sections.push(`\n== ${category.toUpperCase()} SOURCE MATERIAL ==\n${data.contents.join("\n\n")}`);
  }

  const userPrompt = `Synthesize a website page about ${displayName} from the following NCI source material.\n${sections.join("\n")}`;

  return { systemPrompt, userPrompt };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderMarkdown(page: StructuredPage): string {
  const lines: string[] = [];
  const dn = page.displayName;

  lines.push(`# ${dn}: Understanding, Signs, and Next Steps`);
  lines.push("");
  lines.push("## Important Note");
  lines.push(
    "This page is for general educational purposes only. It is not a diagnosis and should not replace medical advice. If you have concerns, please consult a qualified healthcare professional.",
  );
  lines.push("");

  // What is
  lines.push(`## What is ${dn.toLowerCase()}?`);
  lines.push(page.whatIs || MISSING);
  lines.push("");

  // Warning signs
  lines.push("## Common Warning Signs");
  if (page.warningSignsSigns && page.warningSignsSigns.length > 0) {
    for (const s of page.warningSignsSigns) {
      lines.push(`- ${s}`);
    }
  } else {
    lines.push(MISSING);
  }
  lines.push("");

  // Risk factors
  lines.push("## Risk Factors");
  if (page.riskFactors && page.riskFactors.length > 0) {
    for (const r of page.riskFactors) {
      lines.push(`- ${r}`);
    }
  } else {
    lines.push(MISSING);
  }
  lines.push("");

  // Diagnosis
  lines.push(`## How is ${dn.toLowerCase()} diagnosed?`);
  lines.push(page.diagnosis || MISSING);
  lines.push("");

  // Treatment
  lines.push("## Treatment Options");
  lines.push(page.treatmentOptions || MISSING);
  lines.push("");

  // Staging
  lines.push("## Stages Explained Simply");
  lines.push(page.stagesExplained || MISSING);
  lines.push("");

  // When to seek help
  lines.push("## When to Seek Medical Attention");
  lines.push(page.whenToSeekHelp || MISSING);
  lines.push("");

  // Questions
  lines.push("## Questions to Ask Your Doctor");
  if (page.questionsToAsk && page.questionsToAsk.length > 0) {
    for (const q of page.questionsToAsk) {
      lines.push(`- ${q}`);
    }
  } else {
    lines.push(MISSING);
  }
  lines.push("");

  // India helplines
  lines.push("## Where to Get Help in India");
  lines.push("- Indian Cancer Society: 1800-22-1951");
  lines.push("- Ayushman Bharat PM-JAY: 14555");
  lines.push("- Emergency: 112 / 108");
  lines.push("");

  // Sources
  lines.push("## Sources");
  if (page.sources && page.sources.length > 0) {
    for (const s of page.sources) {
      if (s.url) {
        lines.push(`- [${s.title}](${s.url})`);
      } else {
        lines.push(`- ${s.title}`);
      }
    }
  } else {
    lines.push("- NCI PDQ Cancer Information Summaries");
  }
  lines.push("");

  // Ask Suchi
  lines.push("## Ask Suchi");
  lines.push(
    `Still have questions? [Ask Suchi](/) about ${dn.toLowerCase()} -- our AI assistant can help you understand your concerns and guide you to the right resources.`,
  );
  lines.push("");

  // Generation metadata
  lines.push("---");
  lines.push(`*Generated from NCI knowledge base on ${new Date().toISOString().split("T")[0]}. Content is reviewed periodically but may not reflect the latest medical guidelines.*`);
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Safety post-processing
// ---------------------------------------------------------------------------

/**
 * Scan generated markdown for safety violations and flag them.
 */
function runSafetyChecks(markdown: string): string[] {
  const violations: string[] = [];

  // Check for prognosis percentages
  const pctMatch = markdown.match(/\d+\s*%\s*(survival|chance|likelihood|probability|cure|remission)/gi);
  if (pctMatch) {
    violations.push(`SAFETY: Found prognosis percentage -- "${pctMatch[0]}"`);
  }

  // Check for diagnostic language
  const diagPatterns = [
    /you have cancer/gi,
    /you are diagnosed/gi,
    /this means you have/gi,
    /you will (die|not survive)/gi,
    /life expectancy/gi,
  ];
  for (const pat of diagPatterns) {
    const m = markdown.match(pat);
    if (m) {
      violations.push(`SAFETY: Found diagnostic/prognostic language -- "${m[0]}"`);
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  cancerType: string;
  outputDir: string;
  dryRun: boolean;
  verbose: boolean;
}

export async function generatePage(opts: GenerateOptions): Promise<{
  outputPath: string | null;
  sourceCount: number;
  categories: Record<string, number>;
  safetyViolations: string[];
}> {
  const manifest = loadManifest();
  const docs = findDocsForCancerType(manifest, opts.cancerType);

  if (docs.length === 0) {
    console.error(`No NCI docs found for cancer type: "${opts.cancerType}"`);
    return { outputPath: null, sourceCount: 0, categories: {}, safetyViolations: [] };
  }

  // Classify into categories
  const classified = classifyDocs(docs);
  const categoryContents = new Map<string, { contents: string[]; usedDocs: ManifestDoc[] }>();
  const categorySummary: Record<string, number> = {};

  for (const [category, catDocs] of classified) {
    const loaded = loadCategoryContent(catDocs);
    categoryContents.set(category, loaded);
    categorySummary[category] = catDocs.length;
  }

  // Build display name
  const displayName = opts.cancerType
    .split(/[\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") + " Cancer";

  if (opts.verbose) {
    console.log(`\nCancer type: ${opts.cancerType}`);
    console.log(`Total NCI docs found: ${docs.length}`);
    console.log("Categories:");
    for (const [cat, count] of Object.entries(categorySummary)) {
      console.log(`  ${cat}: ${count} docs`);
    }
  }

  if (opts.dryRun) {
    console.log(`\n[DRY RUN] Would generate page for "${displayName}" from ${docs.length} source docs.`);
    return { outputPath: null, sourceCount: docs.length, categories: categorySummary, safetyViolations: [] };
  }

  // Build prompt and call LLM
  const { systemPrompt, userPrompt } = buildSynthesisPrompt(opts.cancerType, displayName, categoryContents);

  console.log(`Calling Gemini to synthesize ${displayName} page...`);
  const rawJson = await callGemini(systemPrompt, userPrompt);

  // Parse structured response
  let page: StructuredPage;
  try {
    page = JSON.parse(rawJson) as StructuredPage;
  } catch (e) {
    // Try to extract JSON from markdown code fence
    const jsonMatch = rawJson.match(/```json?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      page = JSON.parse(jsonMatch[1]) as StructuredPage;
    } else {
      throw new Error(`Failed to parse LLM response as JSON: ${(e as Error).message}\nRaw: ${rawJson.slice(0, 500)}`);
    }
  }

  // Ensure cancerType / displayName are correct
  page.cancerType = opts.cancerType;
  page.displayName = displayName;

  // Render markdown
  const markdown = renderMarkdown(page);

  // Safety checks
  const violations = runSafetyChecks(markdown);
  if (violations.length > 0) {
    console.warn("\nSAFETY VIOLATIONS DETECTED:");
    for (const v of violations) {
      console.warn(`  ${v}`);
    }
    console.warn("Page will still be written but requires manual review.\n");
  }

  // Write output
  const outputDir = path.resolve(opts.outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `${opts.cancerType}-guide.md`);
  fs.writeFileSync(outputPath, markdown, "utf-8");
  console.log(`Written: ${outputPath}`);

  return { outputPath, sourceCount: docs.length, categories: categorySummary, safetyViolations: violations };
}

// ---------------------------------------------------------------------------
// Inventory / dry-run helper (no LLM call)
// ---------------------------------------------------------------------------

export function inventoryCancerTypes(): { cancerType: string; docCount: number; categories: Record<string, number> }[] {
  const manifest = loadManifest();
  const nciDocs = manifest.docs.filter((d) => d.sourceType === "02_nci_core" && d.status === "active");

  // Collect unique cancer types
  const typeSet = new Set<string>();
  for (const doc of nciDocs) {
    for (const ct of doc.cancerTypes) {
      typeSet.add(ct.toLowerCase());
    }
  }

  const results: { cancerType: string; docCount: number; categories: Record<string, number> }[] = [];

  for (const ct of Array.from(typeSet).sort()) {
    const docs = findDocsForCancerType(manifest, ct);
    const classified = classifyDocs(docs);
    const cats: Record<string, number> = {};
    for (const [cat, catDocs] of classified) {
      if (catDocs.length > 0) {
        cats[cat] = catDocs.length;
      }
    }
    results.push({ cancerType: ct, docCount: docs.length, categories: cats });
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  const hasFlag = (name: string): boolean => args.includes(`--${name}`);

  if (hasFlag("inventory")) {
    const inventory = inventoryCancerTypes();
    console.log("\n=== NCI Knowledge Base Inventory ===\n");
    console.log(`Total cancer types: ${inventory.length}`);
    console.log(`${"Cancer Type".padEnd(30)} ${"Docs".padStart(5)}  Categories`);
    console.log("-".repeat(80));
    for (const item of inventory) {
      const catSummary = Object.entries(item.categories)
        .map(([c, n]) => `${c}:${n}`)
        .join(", ");
      console.log(`${item.cancerType.padEnd(30)} ${String(item.docCount).padStart(5)}  ${catSummary}`);
    }
    return;
  }

  const cancerType = getArg("cancer");
  if (!cancerType) {
    console.error("Usage:");
    console.error("  npx ts-node scripts/content-generator/nci-to-website.ts --cancer <type> [--output <dir>] [--dry-run] [--verbose]");
    console.error("  npx ts-node scripts/content-generator/nci-to-website.ts --inventory");
    process.exit(1);
  }

  const outputDir = getArg("output") || DEFAULT_OUTPUT_DIR;
  const dryRun = hasFlag("dry-run");
  const verbose = hasFlag("verbose") || dryRun;

  const result = await generatePage({ cancerType, outputDir, dryRun, verbose });

  if (result.sourceCount === 0) {
    process.exit(1);
  }

  if (!dryRun) {
    console.log(`\nDone. Generated from ${result.sourceCount} NCI source documents.`);
    if (result.safetyViolations.length > 0) {
      console.log(`WARNING: ${result.safetyViolations.length} safety violation(s) detected -- manual review required.`);
    }
  }
}

// Only run main() when executed directly (not imported by generate-all.ts)
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
