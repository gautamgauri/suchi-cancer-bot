/* eslint-disable no-console */
/**
 * Download IRIS-blocked WHO PDFs using Puppeteer (real browser).
 * Run from repo root: npx ts-node apps/api/src/scripts/download-who-iris-puppeteer.ts
 * Or from apps/api: npx ts-node src/scripts/download-who-iris-puppeteer.ts --outputDir ../../kb_sources/who
 *
 * Note: IRIS often returns HTML (bot detection) when run from automation. If you get
 * "Response is not a PDF", download manually from the WHO publication page and save
 * into kb_sources/who/{id}.pdf (e.g. who_patient_navigation_breast_cancer_2024.pdf).
 */
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

const IRIS_DOCS = [
  {
    id: "who_patient_navigation_breast_cancer_2024",
    title: "Patient navigation for early detection, diagnosis and treatment of breast cancer",
    pdfUrl:
      "https://iris.who.int/bitstream/handle/10665/379225/9789240100954-eng.pdf?sequence=1",
  },
  {
    id: "who_palliative_care_planning_2016",
    title: "Planning and implementing palliative care services: a guide for programme managers",
    pdfUrl:
      "https://iris.who.int/bitstream/handle/10665/250584/9789241565417-eng.pdf?sequence=1",
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k: string, def?: string) => {
    const i = args.indexOf(k);
    return i === -1 ? def : args[i + 1];
  };
  const flag = (k: string) => args.includes(k);
  // When run from apps/api, cwd is apps/api; from root, cwd is repo root.
  const defaultOut = path.resolve(process.cwd(), "kb_sources", "who");
  const fromApi = process.cwd().endsWith("apps" + path.sep + "api") || process.cwd().endsWith("apps/api");
  const outputDir = get("--outputDir", fromApi ? path.resolve(process.cwd(), "..", "..", "kb_sources", "who") : defaultOut);
  return {
    outputDir: outputDir!,
    headed: flag("--headed"),
    delayMs: Number(get("--delay", "15000")) || 15000,
  };
}

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.slice(0, 4).toString() === "%PDF";
}

async function main() {
  const { outputDir, headed, delayMs } = parseArgs();
  console.log(`WHO IRIS downloader (Puppeteer) | outputDir=${outputDir} | headed=${headed} | delayMs=${delayMs}`);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: !headed,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    for (let i = 0; i < IRIS_DOCS.length; i++) {
      const doc = IRIS_DOCS[i];
      const outPath = path.join(outputDir, `${doc.id}.pdf`);
      console.log(`\n[${i + 1}/${IRIS_DOCS.length}] ${doc.title}`);
      console.log(`  📥 Navigating to IRIS PDF...`);

      const page = await browser.newPage();
      try {
        const response = await page.goto(doc.pdfUrl, {
          waitUntil: "load",
          timeout: 90_000,
        });
        if (!response) {
          console.log(`  ⚠️ No response`);
          try {
            await page.close();
          } catch {
            // Page may already be closed
          }
          continue;
        }
        const contentType = response.headers()["content-type"] || "";
        const buffer = await response.buffer();
        if (!isPdfBuffer(buffer)) {
          console.log(`  ⚠️ Response is not a PDF (content-type: ${contentType}, size: ${buffer.length}). Likely bot block.`);
          console.log(`  💡 Download manually from WHO publication page and save as ${path.basename(outPath)}`);
          continue;
        }
        fs.writeFileSync(outPath, buffer);
        console.log(`  ✓ Saved ${(buffer.length / 1024 / 1024).toFixed(2)} MB to ${outPath}`);
      } finally {
        try {
          await page.close();
        } catch {
          // Page may already be closed (e.g. after IRIS HTML response)
        }
      }

      if (i < IRIS_DOCS.length - 1) {
        console.log(`  ⏳ Waiting ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  } finally {
    await browser.close();
  }

  console.log("\n✓ Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
