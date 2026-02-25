#!/usr/bin/env npx tsx
/**
 * Compare bot-generated proposal (from funding-eval full suite report or direct API JSON)
 * against a reference proposal (Gully Goal markdown).
 *
 * Usage:
 *   npx tsx scripts/compare-proposal-to-reference.ts \
 *     --report path/to/funding-eval-report.json \
 *     --reference ../reports/gully-goal-rf-esa-2026-27.md \
 *     --out comparison-bot-vs-gully-goal.md
 *
 * Or with a direct proposal run JSON:
 *   npx tsx scripts/compare-proposal-to-reference.ts \
 *     --run path/to/proposal-run.json \
 *     --reference ../reports/gully-goal-rf-esa-2026-27.md \
 *     --out comparison.md
 */

import * as fs from "fs";
import * as path from "path";

// --- CLI arg parsing ---
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const reportPath = getArg("report");
const runPath = getArg("run");
const referencePath = getArg("reference") ?? path.resolve(__dirname, "../../reports/gully-goal-rf-esa-2026-27.md");
const outPath = getArg("out") ?? "comparison-bot-vs-gully-goal.md";

if (!reportPath && !runPath) {
  console.error("Usage: --report <eval-report.json> OR --run <proposal-run.json> --reference <ref.md> [--out <output.md>]");
  process.exit(1);
}

// --- Load reference ---
if (!fs.existsSync(referencePath)) {
  console.error(`Reference file not found: ${referencePath}`);
  process.exit(1);
}
const referenceText = fs.readFileSync(referencePath, "utf-8");

// --- Parse reference sections ---
interface RefSection {
  name: string;
  text: string;
  wordCount: number;
}

function parseReferenceSections(text: string): RefSection[] {
  const sections: RefSection[] = [];
  // Split on lines that look like section headers (all caps or known patterns)
  const knownHeaders = [
    "Background and Problem Statement and Proposed Solution",
    "Objectives of the Project",
    "Expected Results and Outcomes",
    "Final Beneficiaries",
    "Main Activities and Program Implementation Details",
    "Experience in Project Location and with Target Beneficiaries",
    "Core Team",
    "Communication Plan",
    "Detailed Budget",
    "Monitoring and Evaluation Plan",
    "Sustainability",
    "Capability Framework Alignment",
    "Theory of Change",
    "Part 1 - Organization Information",
    "Part 2 - Project Details",
    "Part 3 - Organisation Details",
    "Part 4 - Compliance Checklist",
  ];

  const lines = text.split("\n");
  let currentSection: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const matchedHeader = knownHeaders.find(
      (h) => trimmed.toLowerCase() === h.toLowerCase()
    );
    if (matchedHeader) {
      if (currentSection) {
        const sectionText = currentLines.join("\n").trim();
        sections.push({
          name: currentSection,
          text: sectionText,
          wordCount: sectionText.split(/\s+/).filter(Boolean).length,
        });
      }
      currentSection = matchedHeader;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentSection) {
    const sectionText = currentLines.join("\n").trim();
    sections.push({
      name: currentSection,
      text: sectionText,
      wordCount: sectionText.split(/\s+/).filter(Boolean).length,
    });
  }
  return sections;
}

// --- Load bot proposal ---
interface BotSection {
  name: string;
  draftText: string;
  wordCount: number;
  citationCount: number;
  placeholderCount: number;
  hasError: boolean;
}

interface ProposalRun {
  id: string;
  status: string;
  sections: Array<{
    name: string;
    draftText?: string;
    retrievedChunks?: unknown[];
    citations?: unknown[];
  }>;
  complianceReport?: {
    coverage_score?: number;
    missing_requirements?: string[];
  };
  outline?: {
    proposal_scope?: {
      totalDirectBeneficiaries?: string;
      budgetCeiling?: string;
      programName?: string;
    };
  };
}

function extractProposalRun(data: unknown): ProposalRun | null {
  // Direct proposal run JSON
  if ((data as ProposalRun)?.sections) {
    return data as ProposalRun;
  }
  // From eval report: look for PROP-02 or PROP-04 get_run response
  const report = data as { results?: Array<{ caseId: string; response?: unknown }> };
  if (report?.results) {
    for (const caseId of ["PROP-04", "PROP-02"]) {
      const result = report.results.find((r) => r.caseId === caseId);
      if (result?.response && (result.response as ProposalRun)?.sections) {
        return result.response as ProposalRun;
      }
    }
  }
  return null;
}

function parseBotSections(run: ProposalRun): BotSection[] {
  return (run.sections || []).map((s) => {
    const text = s.draftText ?? "";
    const isError = text.startsWith("Error:") || text.includes("Incorrect API key");
    const citations = (text.match(/\[citation:[^\]]+\]/g) || []).length;
    const placeholders = (text.match(/\{\{MISSING:[^}]+\}\}/g) || []).length;
    return {
      name: s.name,
      draftText: text,
      wordCount: isError ? 0 : text.split(/\s+/).filter(Boolean).length,
      citationCount: citations,
      placeholderCount: placeholders,
      hasError: isError,
    };
  });
}

// --- Comparison ---
function generateComparison(
  refSections: RefSection[],
  botSections: BotSection[],
  run: ProposalRun,
): string {
  const lines: string[] = [];
  const refTotalWords = refSections.reduce((s, r) => s + r.wordCount, 0);
  const botTotalWords = botSections.reduce((s, r) => s + r.wordCount, 0);
  const botTotalCitations = botSections.reduce((s, r) => s + r.citationCount, 0);
  const botTotalPlaceholders = botSections.reduce((s, r) => s + r.placeholderCount, 0);
  const botErrorSections = botSections.filter((s) => s.hasError).length;
  const coverageScore = run.complianceReport?.coverage_score ?? 0;

  lines.push("# Bot vs Gully Goal — Proposal Comparison Report");
  lines.push("");
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push(`**Proposal Run ID**: ${run.id}`);
  lines.push(`**Status**: ${run.status}`);
  lines.push("");

  // High-level summary
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Gully Goal (Reference) | Bot Output |");
  lines.push("|--------|----------------------|------------|");
  lines.push(`| Total Sections | ${refSections.length} | ${botSections.length} |`);
  lines.push(`| Total Words | ${refTotalWords.toLocaleString()} | ${botTotalWords.toLocaleString()} |`);
  lines.push(`| Citations | N/A (manual) | ${botTotalCitations} |`);
  lines.push(`| Placeholders | N/A | ${botTotalPlaceholders} |`);
  lines.push(`| Error Sections | 0 | ${botErrorSections} |`);
  lines.push(`| Coverage Score | N/A | ${coverageScore} |`);
  lines.push(`| Beneficiaries Mentioned | 771 | ${run.outline?.proposal_scope?.totalDirectBeneficiaries ?? "?"} |`);
  lines.push(`| Budget | INR 15,00,000 | ${run.outline?.proposal_scope?.budgetCeiling ?? "?"} |`);
  lines.push("");

  if (botErrorSections > 0) {
    lines.push("## ERRORS DETECTED");
    lines.push("");
    lines.push(`${botErrorSections} of ${botSections.length} sections have errors instead of content.`);
    const errorMsg = botSections.find((s) => s.hasError)?.draftText?.slice(0, 200) ?? "";
    lines.push(`First error: \`${errorMsg}\``);
    lines.push("");
    lines.push("**This means embeddings/retrieval failed. Fix the embedding provider and re-run.**");
    lines.push("");
  }

  // Section-by-section comparison
  lines.push("## Section-by-Section Comparison");
  lines.push("");
  lines.push("| # | Section | Ref Words | Bot Words | Bot Citations | Bot Placeholders | Status |");
  lines.push("|---|---------|-----------|-----------|---------------|------------------|--------|");

  const refMap = new Map(refSections.map((s) => [s.name.toLowerCase(), s]));

  for (let i = 0; i < botSections.length; i++) {
    const bot = botSections[i];
    const ref = refMap.get(bot.name.toLowerCase());
    const refWords = ref?.wordCount ?? 0;
    let status = "";
    if (bot.hasError) {
      status = "ERROR";
    } else if (bot.wordCount === 0) {
      status = "EMPTY";
    } else if (refWords > 0 && bot.wordCount < refWords * 0.3) {
      status = "THIN";
    } else if (refWords > 0 && bot.wordCount >= refWords * 0.7) {
      status = "OK";
    } else {
      status = "PARTIAL";
    }
    lines.push(
      `| ${i + 1} | ${bot.name} | ${refWords} | ${bot.wordCount} | ${bot.citationCount} | ${bot.placeholderCount} | ${status} |`
    );
  }

  // Sections in reference but not in bot
  const botNames = new Set(botSections.map((s) => s.name.toLowerCase()));
  const missingSections = refSections.filter((s) => !botNames.has(s.name.toLowerCase()));
  if (missingSections.length > 0) {
    lines.push("");
    lines.push("### Sections in Reference but Missing from Bot");
    lines.push("");
    for (const s of missingSections) {
      lines.push(`- **${s.name}** (${s.wordCount} words in reference)`);
    }
  }

  lines.push("");

  // Quality dimensions (from the plan.md gap analysis)
  lines.push("## Quality Dimensions Checklist");
  lines.push("");
  lines.push("From the Gully Goal gap analysis (plan.md), checking each dimension:");
  lines.push("");

  const allBotText = botSections.map((s) => s.draftText).join("\n");
  const checks = [
    {
      dim: "Funder-specific framing",
      check: /reliance foundation/i.test(allBotText) && /ESA/i.test(allBotText),
      detail: 'Names "Reliance Foundation" and "ESA" explicitly',
    },
    {
      dim: "Football3 methodology depth",
      check: /football3/i.test(allBotText) && /three halves/i.test(allBotText),
      detail: "Explains football3 three-halves structure",
    },
    {
      dim: "Numbers woven into narrative",
      check: /771/.test(allBotText) && /511/.test(allBotText) && /260/.test(allBotText),
      detail: "Decomposes 771 = 511 + 260",
    },
    {
      dim: "Theory of Change narrative",
      check: /if.*marginalized.*children/i.test(allBotText) || /theory of change/i.test(allBotText),
      detail: "ToC as flowing conditional statement",
    },
    {
      dim: "First-person voice (We/Our)",
      check: /\b(we|our)\b/i.test(allBotText),
      detail: 'Uses "We", "Our team" voice',
    },
    {
      dim: "Board member details",
      check: /saurabh kumar/i.test(allBotText) || /mohita katriar/i.test(allBotText),
      detail: "Includes board members with qualifications",
    },
    {
      dim: "Compliance checklist",
      check: /FCRA/i.test(allBotText) && /80G/i.test(allBotText) && /12A/i.test(allBotText),
      detail: "Includes registration details and compliance",
    },
    {
      dim: "Sustainability (5 mechanisms)",
      check: /youth.led/i.test(allBotText) && /community ownership/i.test(allBotText),
      detail: "Names specific sustainability mechanisms",
    },
    {
      dim: "Capability framework alignment",
      check: /10 core capabilities/i.test(allBotText) || /capability.*framework/i.test(allBotText),
      detail: "Maps capabilities to program activities",
    },
    {
      dim: "Community voice / personal touch",
      check: /executive director plays/i.test(allBotText) || /gautam gauri/i.test(allBotText),
      detail: "Personal, authentic community connection",
    },
  ];

  lines.push("| # | Dimension | Present? | Detail |");
  lines.push("|---|-----------|----------|--------|");
  let passCount = 0;
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const present = c.check ? "YES" : "NO";
    if (c.check) passCount++;
    lines.push(`| ${i + 1} | ${c.dim} | ${present} | ${c.detail} |`);
  }
  lines.push("");
  lines.push(`**Quality Score: ${passCount}/${checks.length} dimensions present**`);
  lines.push("");

  // Bot full text (for manual review)
  if (!botSections.every((s) => s.hasError)) {
    lines.push("## Bot Proposal Full Text");
    lines.push("");
    for (const s of botSections) {
      lines.push(`### ${s.name}`);
      lines.push("");
      if (s.hasError) {
        lines.push(`> ERROR: ${s.draftText.slice(0, 200)}`);
      } else {
        lines.push(s.draftText);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// --- Main ---
async function main() {
  let data: unknown;
  if (runPath) {
    data = JSON.parse(fs.readFileSync(runPath, "utf-8"));
  } else if (reportPath) {
    data = JSON.parse(fs.readFileSync(reportPath!, "utf-8"));
  }

  const run = extractProposalRun(data);
  if (!run) {
    console.error("Could not find a proposal run in the provided file.");
    console.error("For eval reports, ensure PROP-02 or PROP-04 results contain a response with sections.");
    process.exit(1);
  }

  const refSections = parseReferenceSections(referenceText);
  const botSections = parseBotSections(run);

  console.log(`Reference: ${refSections.length} sections, ${refSections.reduce((s, r) => s + r.wordCount, 0)} words`);
  console.log(`Bot: ${botSections.length} sections, ${botSections.reduce((s, r) => s + r.wordCount, 0)} words`);

  const comparison = generateComparison(refSections, botSections, run);

  const resolvedOut = path.resolve(outPath);
  fs.writeFileSync(resolvedOut, comparison, "utf-8");
  console.log(`\nComparison written to: ${resolvedOut}`);

  // Print summary to console
  const errorCount = botSections.filter((s) => s.hasError).length;
  if (errorCount > 0) {
    console.log(`\nWARNING: ${errorCount}/${botSections.length} sections have errors (embeddings broken)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
