/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import pdfParse from "pdf-parse";

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
  publication_date?: string | null;
};

type CliOpts = {
  sitemapUrl: string;
  outputDir: string;
  kbRoot: string;
  delayMs: number;
  maxDocs: number;
  dryRun: boolean;
  resume: boolean;
};

// Oncology-related keywords for filtering
const ONCOLOGY_KEYWORDS = [
  "cancer",
  "oncology",
  "tumor",
  "tumour",
  "carcinoma",
  "breast",
  "lung",
  "colorectal",
  "prostate",
  "cervical",
  "screening",
  "prevention",
  "diagnosis",
  "treatment",
  "chemotherapy",
  "radiotherapy",
  "palliative",
  "navigation",
];

// Cancer type mapping from keywords
const CANCER_TYPE_MAP: Record<string, string[]> = {
  breast: ["breast"],
  lung: ["lung"],
  colorectal: ["colorectal", "colon", "rectal"],
  prostate: ["prostate"],
  cervical: ["cervical", "cervix"],
  liver: ["liver", "hepatic"],
  stomach: ["stomach", "gastric"],
  esophageal: ["esophageal", "esophagus"],
  pancreatic: ["pancreatic", "pancreas"],
  ovarian: ["ovarian", "ovary"],
};

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  const get = (k: string, def?: string) => {
    const i = args.indexOf(k);
    return i === -1 ? def : args[i + 1];
  };
  const flag = (k: string) => args.includes(k);

  return {
    sitemapUrl:
      get("--sitemap") ||
      "https://www.who.int/sitemaps/sitemapindex.xml",
    outputDir: get("--outputDir", "kb_sources/who") || "kb_sources/who",
    kbRoot: get("--kbRoot", "kb") || "kb",
    delayMs: Number(get("--delay", "30000")) || 30000, // 30s default
    maxDocs: Number(get("--maxDocs", "10")) || 10, // Limit for testing
    dryRun: flag("--dryRun"),
    resume: flag("--resume"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFilename(s: string): string {
  return s
    .replace(/[^a-z0-9]/gi, "_")
    .replace(/_+/g, "_")
    .toLowerCase()
    .substring(0, 100);
}

function extractYear(text: string): number | null {
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function extractCancerTypes(text: string): string[] {
  const lower = text.toLowerCase();
  const types: string[] = [];
  for (const [type, keywords] of Object.entries(CANCER_TYPE_MAP)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      types.push(type);
    }
  }
  return types.length > 0 ? types : ["general"];
}

function isOncologyRelated(url: string, title?: string): boolean {
  const combined = `${url} ${title || ""}`.toLowerCase();
  return ONCOLOGY_KEYWORDS.some((kw) => combined.includes(kw));
}

async function fetchWithRetry(
  url: string,
  maxRetries = 3,
  delayMs = 1000
): Promise<any> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: 60000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Suchi-KB-Crawler/1.0; +https://suchi.ai)",
        },
        maxRedirects: 5,
      });
      return response;
    } catch (error: any) {
      lastError = error;
      if (error.response?.status === 403 || error.response?.status === 429) {
        console.log(
          `  ⚠️ Rate limited (${error.response.status}), waiting ${delayMs * 2}ms...`
        );
        await sleep(delayMs * 2);
        continue;
      }
      if (attempt < maxRetries - 1) {
        await sleep(delayMs * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  console.log(`Fetching sitemap: ${sitemapUrl}`);
  const response = await fetchWithRetry(sitemapUrl);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const parsed = parser.parse(response.data);

  const urls: string[] = [];

  // Handle sitemap index
  if (parsed.sitemapindex?.sitemap) {
    const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
      ? parsed.sitemapindex.sitemap
      : [parsed.sitemapindex.sitemap];
    for (const sitemap of sitemaps) {
      if (sitemap.loc) {
        urls.push(sitemap.loc);
      }
    }
  }

  // Handle regular sitemap
  if (parsed.urlset?.url) {
    const urlEntries = Array.isArray(parsed.urlset.url)
      ? parsed.urlset.url
      : [parsed.urlset.url];
    for (const entry of urlEntries) {
      if (entry.loc) {
        urls.push(entry.loc);
      }
    }
  }

  return urls;
}

async function extractPublicationMetadata(
  pageUrl: string
): Promise<Partial<WHOIngestionRecord>> {
  try {
    const response = await fetchWithRetry(pageUrl);
    const $ = cheerio.load(response.data);

    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("h1").first().text().trim() ||
      $("title").text().trim();

    // Try to find PDF download link
    let pdfUrl: string | null = null;
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().toLowerCase();
      if (
        href &&
        (href.endsWith(".pdf") ||
          text.includes("download") ||
          text.includes("pdf"))
      ) {
        const fullUrl = href.startsWith("http")
          ? href
          : new URL(href, pageUrl).toString();
        if (fullUrl.endsWith(".pdf") || fullUrl.includes("/docs/default-source/")) {
          pdfUrl = fullUrl;
          return false; // break
        }
      }
    });

    // Extract year from title or page
    const year = extractYear(title + " " + $("body").text());

    // Try to find citation or license
    const bodyText = $("body").text();
    const citationMatch = bodyText.match(/citation[:\s]+(.+?)(?:\n|$)/i);
    const licenseMatch = bodyText.match(/license[:\s]+(.+?)(?:\n|$)/i);

    return {
      title: title || undefined,
      year: year || undefined,
      pdf_url: pdfUrl || undefined,
      citation: citationMatch?.[1]?.trim() || undefined,
      license: licenseMatch?.[1]?.trim() || "CC BY-NC-SA 3.0 IGO",
    };
  } catch (error: any) {
    console.warn(`  ⚠️ Failed to extract metadata from ${pageUrl}: ${error.message}`);
    return {};
  }
}

async function downloadPdf(
  pdfUrl: string,
  outputPath: string
): Promise<boolean> {
  try {
    const response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
      timeout: 120000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Suchi-KB-Crawler/1.0; +https://suchi.ai)",
      },
    });

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, response.data);
    return true;
  } catch (error: any) {
    console.error(`  ✗ Failed to download PDF: ${error.message}`);
    return false;
  }
}

function pdfToMarkdown(pdfBuffer: Buffer): string {
  // Simple text extraction - in production you might want more sophisticated formatting
  // For now, we'll use pdf-parse to extract text and format it minimally
  try {
    const data = pdfParse(pdfBuffer);
    let text = data.text;

    // Basic markdown formatting
    // Split into paragraphs
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    // Try to detect headings (lines that are short and all caps or title case)
    const formatted: string[] = [];
    for (const para of paragraphs) {
      if (
        para.length < 100 &&
        (para === para.toUpperCase() ||
          /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(para))
      ) {
        formatted.push(`## ${para}\n`);
      } else {
        formatted.push(`${para}\n`);
      }
    }

    return formatted.join("\n");
  } catch (error: any) {
    console.error(`  ⚠️ PDF parsing error: ${error.message}`);
    return ""; // Return empty if parsing fails
  }
}

function generateId(title: string, year?: number): string {
  const base = sanitizeFilename(title);
  const suffix = year ? `_${year}` : "";
  return `who_${base}${suffix}`;
}

async function processPublication(
  pageUrl: string,
  opts: CliOpts,
  checkpoint: Set<string>
): Promise<WHOIngestionRecord | null> {
  if (checkpoint.has(pageUrl)) {
    console.log(`  ⏭️ Skipping already processed: ${pageUrl}`);
    return null;
  }

  console.log(`\n📄 Processing: ${pageUrl}`);

  // Extract metadata from page
  const metadata = await extractPublicationMetadata(pageUrl);
  if (!metadata.title) {
    console.log(`  ⏭️ Skipping (no title found)`);
    return null;
  }

  if (!isOncologyRelated(pageUrl, metadata.title)) {
    console.log(`  ⏭️ Skipping (not oncology-related)`);
    return null;
  }

  const id = generateId(metadata.title, metadata.year || undefined);
  const pdfUrl = metadata.pdf_url;

  if (!pdfUrl) {
    console.log(`  ⏭️ Skipping (no PDF found)`);
    return null;
  }

  if (opts.dryRun) {
    console.log(`  ✓ Would download: ${pdfUrl}`);
    return {
      id,
      page_url: pageUrl,
      pdf_url: pdfUrl,
      local_pdf_path: path.join(opts.outputDir, `${id}.pdf`),
      markdown_path: null,
      title: metadata.title,
      year: metadata.year || undefined,
      source: "World Health Organization",
      source_type: "03_who_public_health",
      language: "en",
      license: metadata.license,
      citation: metadata.citation,
      cancer_types: extractCancerTypes(metadata.title),
      topics: [],
      audience_level: "patient",
      status: "active",
    };
  }

  // Download PDF
  const pdfPath = path.join(opts.outputDir, `${id}.pdf`);
  console.log(`  📥 Downloading PDF...`);
  const downloaded = await downloadPdf(pdfUrl, pdfPath);
  if (!downloaded) {
    return null;
  }

  // Convert PDF to markdown
  console.log(`  📝 Converting to markdown...`);
  const pdfBuffer = fs.readFileSync(pdfPath);
  const markdown = pdfToMarkdown(pdfBuffer);

  if (!markdown || markdown.trim().length < 100) {
    console.log(`  ⚠️ Markdown too short, skipping`);
    return null;
  }

  // Save markdown
  const mdPath = path.join(
    opts.kbRoot,
    "en",
    "03_who_public_health",
    `${id}.md`
  );
  const mdDir = path.dirname(mdPath);
  if (!fs.existsSync(mdDir)) {
    fs.mkdirSync(mdDir, { recursive: true });
  }

  // Add YAML frontmatter
  const frontmatter = {
    id,
    title: metadata.title,
    version: metadata.year ? String(metadata.year) : "v1",
    status: "active",
    source: "World Health Organization",
    sourceType: "03_who_public_health",
    path: path.relative(opts.kbRoot, mdPath).replace(/\\/g, "/"),
    license: metadata.license,
    url: pageUrl,
    citation: metadata.citation,
    language: "en",
    audienceLevel: "patient",
    cancerTypes: extractCancerTypes(metadata.title),
    tags: [],
  };

  const content = `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n${markdown}`;
  fs.writeFileSync(mdPath, content, "utf8");

  console.log(`  ✓ Saved: ${mdPath}`);

  return {
    id,
    page_url: pageUrl,
    pdf_url: pdfUrl,
    local_pdf_path: pdfPath,
    markdown_path: mdPath,
    title: metadata.title,
    year: metadata.year || undefined,
    source: "World Health Organization",
    source_type: "03_who_public_health",
    language: "en",
    license: metadata.license,
    citation: metadata.citation,
    cancer_types: extractCancerTypes(metadata.title),
    topics: [],
    audience_level: "patient",
    status: "active",
    publication_date: metadata.year ? `${metadata.year}-01-01` : undefined,
  };
}

async function main() {
  const opts = parseArgs();
  console.log(`WHO Crawler | sitemap=${opts.sitemapUrl} | delay=${opts.delayMs}ms | maxDocs=${opts.maxDocs} | dryRun=${opts.dryRun}`);

  // Load checkpoint if resuming
  const checkpointFile = path.join(opts.outputDir, ".crawler-checkpoint.json");
  let checkpoint: Set<string> = new Set();
  if (opts.resume && fs.existsSync(checkpointFile)) {
    const checkpointData = JSON.parse(
      fs.readFileSync(checkpointFile, "utf8")
    );
    checkpoint = new Set(checkpointData.processedUrls || []);
    console.log(`Resuming: ${checkpoint.size} URLs already processed`);
  }

  // Parse sitemap
  const urls = await parseSitemap(opts.sitemapUrl);
  console.log(`Found ${urls.length} URLs in sitemap`);

  // Filter and process
  const records: WHOIngestionRecord[] = [];
  let processed = 0;

  for (const url of urls) {
    if (processed >= opts.maxDocs) {
      console.log(`\nReached maxDocs limit (${opts.maxDocs})`);
      break;
    }

    const record = await processPublication(url, opts, checkpoint);
    if (record) {
      records.push(record);
      checkpoint.add(url);
      processed++;

      // Save checkpoint
      if (!opts.dryRun) {
        fs.writeFileSync(
          checkpointFile,
          JSON.stringify({ processedUrls: Array.from(checkpoint) }, null, 2)
        );
      }
    }

    // Rate limiting
    if (processed < urls.length && processed < opts.maxDocs) {
      console.log(`  ⏳ Waiting ${opts.delayMs}ms before next request...`);
      await sleep(opts.delayMs);
    }
  }

  // Save records
  const recordsPath = path.join(opts.outputDir, "who_ingestion_records.json");
  if (!opts.dryRun) {
    fs.writeFileSync(
      recordsPath,
      JSON.stringify(records, null, 2),
      "utf8"
    );
    console.log(`\n✓ Saved ${records.length} records to ${recordsPath}`);
  } else {
    console.log(`\n✓ Would save ${records.length} records`);
  }

  console.log(`\n✓ Crawl complete! Processed ${processed} publications.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
