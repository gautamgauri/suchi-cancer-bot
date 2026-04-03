#!/usr/bin/env ts-node
/**
 * Batch generator -- produces website pages for all major cancer types.
 *
 * Usage:
 *   npx ts-node scripts/content-generator/generate-all.ts [--output <dir>] [--dry-run] [--verbose]
 *   npx ts-node scripts/content-generator/generate-all.ts --dry-run   # preview without LLM calls
 */

import * as path from "path";
import { generatePage, inventoryCancerTypes } from "./nci-to-website";

// ---------------------------------------------------------------------------
// Target cancer types -- the 20 major types we generate pages for.
// These must match cancerType values in kb/manifest.json.
// ---------------------------------------------------------------------------

const TARGET_CANCER_TYPES = [
  "breast",
  "head and neck",   // includes oral/laryngeal
  "cervical",
  "lung",
  "colorectal",
  "prostate",
  "ovarian",
  "stomach",
  "liver",
  "pancreatic",
  "kidney",
  "bladder",
  "leukemia",
  "lymphoma",
  "skin",            // includes melanoma
  "thyroid",
  "uterine",         // includes endometrial
  "esophageal",
  "brain",
  "testicular",
];

const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../../kb/en/website");

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

  const outputDir = getArg("output") || DEFAULT_OUTPUT_DIR;
  const dryRun = hasFlag("dry-run");
  const verbose = hasFlag("verbose") || dryRun;

  // Show inventory first
  const inventory = inventoryCancerTypes();
  const inventoryMap = new Map(inventory.map((i) => [i.cancerType, i]));

  console.log("=== Content Generation Pipeline ===\n");
  console.log(`Mode: ${dryRun ? "DRY RUN (no LLM calls)" : "GENERATE"}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Target cancer types: ${TARGET_CANCER_TYPES.length}\n`);

  // Validate all targets exist in manifest
  const missing: string[] = [];
  for (const ct of TARGET_CANCER_TYPES) {
    if (!inventoryMap.has(ct)) {
      missing.push(ct);
    }
  }
  if (missing.length > 0) {
    console.warn(`WARNING: No NCI data found for: ${missing.join(", ")}`);
  }

  // Summary table
  console.log(`${"Cancer Type".padEnd(25)} ${"NCI Docs".padStart(8)}  ${"Status"}`);
  console.log("-".repeat(60));

  for (const ct of TARGET_CANCER_TYPES) {
    const inv = inventoryMap.get(ct);
    const count = inv ? inv.docCount : 0;
    const status = count > 0 ? "ready" : "NO DATA";
    console.log(`${ct.padEnd(25)} ${String(count).padStart(8)}  ${status}`);
  }

  const totalDocs = TARGET_CANCER_TYPES.reduce(
    (sum, ct) => sum + (inventoryMap.get(ct)?.docCount || 0),
    0,
  );
  console.log("-".repeat(60));
  console.log(`${"TOTAL".padEnd(25)} ${String(totalDocs).padStart(8)}\n`);

  if (dryRun) {
    console.log("[DRY RUN] No pages generated. Remove --dry-run to generate.\n");

    // Show per-type category breakdown
    console.log("=== Category Breakdown ===\n");
    for (const ct of TARGET_CANCER_TYPES) {
      const inv = inventoryMap.get(ct);
      if (!inv) continue;
      const cats = Object.entries(inv.categories)
        .map(([c, n]) => `${c}:${n}`)
        .join(", ");
      console.log(`  ${ct.padEnd(25)} ${cats}`);
    }
    console.log("");
    return;
  }

  // Generate pages sequentially to avoid rate limiting
  const results: { type: string; success: boolean; violations: number }[] = [];
  let successCount = 0;

  for (const ct of TARGET_CANCER_TYPES) {
    const inv = inventoryMap.get(ct);
    if (!inv || inv.docCount === 0) {
      console.log(`\nSkipping "${ct}" -- no NCI data`);
      results.push({ type: ct, success: false, violations: 0 });
      continue;
    }

    console.log(`\n--- Generating: ${ct} ---`);
    try {
      const result = await generatePage({
        cancerType: ct,
        outputDir,
        dryRun: false,
        verbose,
      });

      results.push({
        type: ct,
        success: !!result.outputPath,
        violations: result.safetyViolations.length,
      });

      if (result.outputPath) {
        successCount++;
      }

      // Small delay between calls to be gentle on the API
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`ERROR generating ${ct}:`, (err as Error).message);
      results.push({ type: ct, success: false, violations: 0 });
    }
  }

  // Final summary
  console.log("\n=== Generation Summary ===\n");
  console.log(`${"Cancer Type".padEnd(25)} ${"Result".padEnd(10)} ${"Safety"}`);
  console.log("-".repeat(50));
  for (const r of results) {
    const status = r.success ? "OK" : "FAILED";
    const safety = r.violations > 0 ? `${r.violations} violation(s)` : "clean";
    console.log(`${r.type.padEnd(25)} ${status.padEnd(10)} ${r.success ? safety : "-"}`);
  }
  console.log("-".repeat(50));
  console.log(`Generated: ${successCount}/${TARGET_CANCER_TYPES.length}`);

  const totalViolations = results.reduce((s, r) => s + r.violations, 0);
  if (totalViolations > 0) {
    console.log(`\nWARNING: ${totalViolations} total safety violation(s) across all pages. Manual review required.`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
