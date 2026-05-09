import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArticle } from "./parser";
import { loadQueue } from "./queue-manager";
import { generatePack, GeneratedPack, ChannelName } from "./generator";
import { checkSafety, SafetyReport } from "./safety-checker";
import { checkEthics, EthicsReport } from "./ethics-checker";
import { validateSchema, SchemaReport } from "./schema-validator";
import { writePack } from "./pack-writer";
import { scoreHooks, HookReport } from "./hook-scorer";
import { scoreEditorial, EditorialReport } from "./editorial-scorer";

const REPO_ROOT = path.resolve(__dirname, "..");
const QUEUE_PATH = path.resolve(__dirname, "queue.json");

async function cmdParse(articleArg: string): Promise<void> {
  // Accept absolute path or path relative to repo root
  const articlePath = path.isAbsolute(articleArg)
    ? articleArg
    : path.resolve(REPO_ROOT, articleArg);

  // Derive a placeholder canonical URL from the file path for smoke-test purposes
  const slug = path.basename(articlePath, ".md");
  const placeholderUrl = `https://suchitracancercare.org/cancer-type/${slug}/`;

  const article = await parseArticle(articlePath, placeholderUrl);

  const wordCount = article.body.split(/\s+/).filter(Boolean).length;

  console.log("=== Parse result ===");
  console.log(`slug          : ${article.slug}`);
  console.log(`title         : ${article.title}`);
  console.log(`contentType   : ${article.contentType}`);
  console.log(`canonicalUrl  : ${article.canonicalUrl}`);
  console.log(`body words    : ${wordCount}`);
  console.log(
    `warningSigns  : ${article.warningSigns ? "found" : "not found"}`
  );
  console.log(`nextSteps     : ${article.nextSteps ? "found" : "not found"}`);
  console.log(
    `diagnosticTests: ${article.diagnosticTests ? "found" : "not found"}`
  );
}

async function cmdQueue(): Promise<void> {
  const entries = await loadQueue(QUEUE_PATH);

  const col = {
    slug: Math.max(4, ...entries.map((e) => e.slug.length)),
    title: Math.max(5, ...entries.map((e) => e.title.length)),
    status: Math.max(6, ...entries.map((e) => e.status.length)),
  };

  const pad = (s: string, n: number) => s.padEnd(n);
  const line = `${pad("SLUG", col.slug)}  ${pad("TITLE", col.title)}  ${pad("STATUS", col.status)}`;
  const divider = "-".repeat(line.length);

  console.log(divider);
  console.log(line);
  console.log(divider);

  for (const e of entries) {
    console.log(
      `${pad(e.slug, col.slug)}  ${pad(e.title, col.title)}  ${pad(e.status, col.status)}`
    );
  }

  console.log(divider);
  console.log(`Total: ${entries.length} entries`);

  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.status] = (counts[e.status] ?? 0) + 1;
  }
  for (const [status, count] of Object.entries(counts)) {
    console.log(`  ${status}: ${count}`);
  }
}

const PROMPTS_DIR = path.resolve(__dirname, "prompts");
const PACKS_DIR = path.resolve(__dirname, "packs");

// ---------------------------------------------------------------------------
// Safety report printer (shared by generate + check commands)
// ---------------------------------------------------------------------------

function printSafetyReport(report: SafetyReport): void {
  console.log("\n=== Safety Check ===");
  for (const [channel, result] of Object.entries(report.channels)) {
    if (result.passed) {
      console.log(`[${channel}] PASS`);
    } else {
      const descriptions = result.violations.map((v) => v.description).join("; ");
      console.log(`[${channel}] FAIL: ${descriptions}`);
    }
  }
  console.log(
    `\nOverall: ${report.allPassed ? "ALL PASSED" : "SOME CHANNELS FAILED"}`
  );
}

// ---------------------------------------------------------------------------
// Ethics report printer (shared by generate + check commands)
// ---------------------------------------------------------------------------

function printEthicsReport(report: EthicsReport): void {
  console.log("\n=== Ethics Check (advisory) ===");
  for (const [channel, result] of Object.entries(report.channels)) {
    if (result.violations.length === 0) {
      console.log(`[${channel}] PASS`);
    } else {
      for (const v of result.violations) {
        // Distinguish advisory-only violations (E4) from blocking ones (E1-E3)
        const tag = v.rule === "survivor_exceptionalism" ? "ADVISORY" : "FAIL";
        console.log(`[${channel}] ${tag} [${v.rule}]: ${v.description}`);
      }
    }
  }
  console.log(
    `\nOverall: ${report.allPassed ? "ALL PASSED" : "SOME CHANNELS HAVE VIOLATIONS"} (pipeline continues regardless)`
  );
}

// ---------------------------------------------------------------------------
// Schema report printer (shared by generate + schema commands)
// ---------------------------------------------------------------------------

function printSchemaReport(report: SchemaReport): void {
  console.log("\n=== Schema Validation ===");
  for (const [channel, result] of Object.entries(report.channels)) {
    if (result.passed) {
      console.log(`[${channel}] PASS`);
    } else {
      for (const v of result.violations) {
        console.log(`[${channel}] FAIL [${v.rule}]: ${v.description} (actual: ${v.actual}, expected: ${v.expected})`);
      }
    }
  }
  console.log(
    `\nOverall: ${report.allPassed ? "ALL PASSED" : "SOME CHANNELS FAILED"}`
  );
}

// ---------------------------------------------------------------------------
// Hook report printer
// ---------------------------------------------------------------------------

function printEditorialReport(report: EditorialReport): void {
  const channelOrder: ChannelName[] = [
    "linkedin", "twitter", "instagram", "whatsapp", "youtube_short",
  ];
  const dimNames = [
    "calmUrgency", "humanFirst", "indiaGrounded", "clinicallyHumble", "practical",
  ] as const;

  console.log("\n=== Editorial Scores ===");
  for (const channel of channelOrder) {
    const result = report.channels[channel];
    if (!result) continue;

    const label = `[${channel}]`.padEnd(16);
    console.log(`${label} ${result.totalScore}/100  ${result.grade}`);

    for (const dim of dimNames) {
      const d = result.dimensions[dim];
      const dimLabel = d.name.padEnd(18);
      const bar = "█".repeat(d.score) + "░".repeat(d.max - d.score);
      console.log(`  ${dimLabel} ${String(d.score).padStart(2)}/${d.max}  ${bar}`);
      for (const sig of d.signals) {
        console.log(`    ${sig}`);
      }
    }
  }
  console.log(`\nAverage editorial score: ${report.averageScore}/100  ${report.overallGrade}`);
}

function printHookReport(report: HookReport): void {
  const channelOrder: Array<keyof typeof report.channels> = [
    "linkedin",
    "twitter",
    "instagram",
    "whatsapp",
    "youtube_short",
  ];

  console.log("\n=== Hook Scores ===");
  for (const channel of channelOrder) {
    const scored = report.channels[channel];
    if (!scored) continue; // skipped (failed channel)

    const label = `[${channel}]`.padEnd(16);
    const scoreStr = `${scored.score}/100`;
    if (scored.suggestion) {
      console.log(`${label} ${scoreStr}  ⚠ ${scored.suggestion}`);
    } else {
      console.log(`${label} ${scoreStr}  ✓`);
    }
  }
  console.log(`\nAverage hook score: ${report.averageScore}/100`);
}

async function cmdGenerate(articleArg: string): Promise<void> {
  // Accept absolute path or path relative to repo root
  const articlePath = path.isAbsolute(articleArg)
    ? articleArg
    : path.resolve(REPO_ROOT, articleArg);

  // Derive canonical URL from the file path (same logic as parse command)
  const slug = path.basename(articlePath, ".md");
  const canonicalUrl = `https://suchitracancercare.org/cancer-type/${slug}/`;

  console.log(`Parsing: ${articlePath}`);
  const article = await parseArticle(articlePath, canonicalUrl);
  console.log(`Generating pack for: ${article.title} (${article.slug})`);

  const pack = await generatePack(article, PROMPTS_DIR);

  // Print summary — channel name + first 100 chars of content (or error)
  console.log("\n=== Generation Summary ===");
  for (const [channel, result] of Object.entries(pack.channels)) {
    if (result.status === "ok") {
      const preview = result.content.replace(/\n/g, " ").substring(0, 100);
      console.log(`[${channel}] OK   : ${preview}${result.content.length > 100 ? "…" : ""}`);
    } else {
      console.log(`[${channel}] FAIL : ${result.error}`);
    }
  }

  // Run safety check and embed report in pack JSON
  const safetyReport = checkSafety(pack);
  printSafetyReport(safetyReport);

  // Run ethics check — advisory layer (fearbait, overclaiming, alarm without action,
  // survivor exceptionalism).  Violations are printed for reviewer action but do NOT
  // block the pipeline.
  const ethicsReport = checkEthics(pack);
  printEthicsReport(ethicsReport);

  // Run deterministic schema validation (non-blocking — reports but never exits)
  const schemaReport = validateSchema(pack);
  printSchemaReport(schemaReport);

  // Score opening hooks — advisory, never blocks the pipeline
  const hookReport = scoreHooks(pack);
  printHookReport(hookReport);

  // Score full editorial quality against Suchi Editorial Principles
  const editorialReport = scoreEditorial(pack);
  printEditorialReport(editorialReport);

  // Save pack JSON (with safety report + approval token) and send review email
  const writeResult = await writePack(pack, safetyReport, PACKS_DIR);

  console.log(`\nPack saved → ${writeResult.packPath}`);
  if (writeResult.emailSent) {
    console.log(`Email sent → gautamgauri@dikshafoundation.org, divya.vats@dikshafoundation.org`);
  } else if (writeResult.emailError) {
    console.log(`Email failed — ${writeResult.emailError}`);
  } else {
    console.log(`Email skipped — SMTP not configured (set SMTP_PASS env var or configure Secret Manager)`);
  }
}

async function cmdCheck(packArg: string): Promise<void> {
  const packPath = path.isAbsolute(packArg)
    ? packArg
    : path.resolve(process.cwd(), packArg);

  const raw = await fs.readFile(packPath, "utf-8");
  const pack = JSON.parse(raw) as GeneratedPack;

  console.log(`Checking: ${packPath}`);
  console.log(`Pack: ${pack.articleSlug} (generated ${pack.generatedAt})`);

  const report = checkSafety(pack);
  printSafetyReport(report);

  const ethicsReport = checkEthics(pack);
  printEthicsReport(ethicsReport);

  const editorialReport = scoreEditorial(pack);
  printEditorialReport(editorialReport);
}

async function cmdSchema(packArg: string): Promise<void> {
  const packPath = path.isAbsolute(packArg)
    ? packArg
    : path.resolve(process.cwd(), packArg);

  const raw = await fs.readFile(packPath, "utf-8");
  const pack = JSON.parse(raw) as GeneratedPack;

  console.log(`Schema-validating: ${packPath}`);
  console.log(`Pack: ${pack.articleSlug} (generated ${pack.generatedAt})`);

  const report = validateSchema(pack);
  printSchemaReport(report);
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (!command) {
    console.error("Usage:");
    console.error(
      "  npx ts-node distribution/cli.ts parse <article-path>"
    );
    console.error("  npx ts-node distribution/cli.ts queue");
    console.error(
      "  npx ts-node distribution/cli.ts generate <article-path>"
    );
    console.error(
      "  npx ts-node distribution/cli.ts check <pack-json-path>"
    );
    console.error(
      "  npx ts-node distribution/cli.ts schema <pack-json-path>"
    );
    process.exit(1);
  }

  switch (command) {
    case "parse": {
      const articleArg = args[0];
      if (!articleArg) {
        console.error("Error: article path required");
        console.error(
          "  npx ts-node distribution/cli.ts parse <article-path>"
        );
        process.exit(1);
      }
      await cmdParse(articleArg);
      break;
    }
    case "queue": {
      await cmdQueue();
      break;
    }
    case "generate": {
      const articleArg = args[0];
      if (!articleArg) {
        console.error("Error: article path required");
        console.error(
          "  npx ts-node distribution/cli.ts generate <article-path>"
        );
        process.exit(1);
      }
      await cmdGenerate(articleArg);
      break;
    }
    case "check": {
      const packArg = args[0];
      if (!packArg) {
        console.error("Error: pack JSON path required");
        console.error(
          "  npx ts-node distribution/cli.ts check <pack-path>"
        );
        process.exit(1);
      }
      await cmdCheck(packArg);
      break;
    }
    case "schema": {
      const packArg = args[0];
      if (!packArg) {
        console.error("Error: pack JSON path required");
        console.error(
          "  npx ts-node distribution/cli.ts schema <pack-json-path>"
        );
        process.exit(1);
      }
      await cmdSchema(packArg);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
