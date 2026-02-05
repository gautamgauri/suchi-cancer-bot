/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import axios from "axios";

// Matches WHOIngestionRecord used by generate-who-manifest-snippet.ts
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

type CliOpts = {
  outputDir: string;
  kbRoot: string;
  delayMs: number;
  dryRun: boolean;
};

// Hosts that typically allow programmatic PDF access (no IRIS-style bot detection).
// URLs from these are tried first; IRIS (iris.who.int) is tried last.
const PREFERRED_HOSTS = [
  "afro.who.int",
  "www.afro.who.int",
  "paho.org",
  "www.paho.org",
  "screening.iarc.fr",
  "publications.iarc.fr",
  "www.who.int",
  "apps.who.int",
  "cdn.who.int",
];

const IRIS_HOST = "iris.who.int";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isPreferredHost(url: string): boolean {
  const host = hostOf(url);
  return PREFERRED_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

function isIrisHost(url: string): boolean {
  return hostOf(url).includes(IRIS_HOST);
}

/** Sort URLs so preferred hosts are tried first, IRIS last. */
function sortPdfUrlsPreferredFirst(urls: string[]): string[] {
  return [...urls].sort((a, b) => {
    const aPreferred = isPreferredHost(a);
    const bPreferred = isPreferredHost(b);
    if (aPreferred && !bPreferred) return -1;
    if (!aPreferred && bPreferred) return 1;
    const aIris = isIrisHost(a);
    const bIris = isIrisHost(b);
    if (!aIris && bIris) return -1;
    if (aIris && !bIris) return 1;
    return 0;
  });
}

// Priority WHO cancer/navigation PDFs for Suchi KB.
// pdfUrls: try in order (non-IRIS first, IRIS last). Add alternate non-IRIS URLs when available.
const WHO_DOCS: Array<{
  id: string;
  title: string;
  pageUrl: string;
  pdfUrls: string[];
  year: number;
  topics: string[];
  cancerTypes: string[];
  audienceLevel: WHOIngestionRecord["audience_level"];
  publicationDate?: string;
  citation?: string;
}> = [
  {
    id: "who_patient_navigation_breast_cancer_2024",
    title: "Patient navigation for early detection, diagnosis and treatment of breast cancer",
    pageUrl: "https://www.who.int/publications/i/item/9789240100954",
    pdfUrls: [
      "https://iris.who.int/bitstream/handle/10665/379225/9789240100954-eng.pdf?sequence=1",
    ],
    year: 2024,
    topics: ["patient_navigation", "breast_cancer", "early_detection", "diagnosis", "treatment"],
    cancerTypes: ["breast"],
    audienceLevel: "technical",
    publicationDate: "2024-10-01",
    citation: "World Health Organization. Patient navigation for early detection, diagnosis and treatment of breast cancer: technical brief. Geneva: World Health Organization; 2024.",
  },
  {
    id: "who_guide_cancer_early_diagnosis_2017",
    title: "Guide to cancer early diagnosis",
    pageUrl: "https://www.afro.who.int/sites/default/files/2017-05/9789241511940-eng.pdf",
    pdfUrls: ["https://www.afro.who.int/sites/default/files/2017-05/9789241511940-eng.pdf"],
    year: 2017,
    topics: ["early_diagnosis", "symptomatic_presentation", "diagnosis", "treatment_access"],
    cancerTypes: ["general"],
    audienceLevel: "technical",
    publicationDate: "2017-01-01",
    citation: "World Health Organization. Guide to cancer early diagnosis. Geneva: World Health Organization; 2017.",
  },
  {
    id: "who_cancer_control_planning_2006",
    title: "Cancer Control: Knowledge into Action — Module 1: Planning",
    pageUrl: "https://www.paho.org/sites/default/files/WHO-Cancer-Modules-Planning.pdf",
    pdfUrls: ["https://www.paho.org/sites/default/files/WHO-Cancer-Modules-Planning.pdf"],
    year: 2006,
    topics: ["cancer_control", "planning", "referral_design", "system_navigation", "scaling"],
    cancerTypes: ["general"],
    audienceLevel: "technical",
    publicationDate: "2006-01-01",
    citation: "World Health Organization. Cancer Control: Knowledge into Action — Module 1: Planning. Geneva: World Health Organization; 2006.",
  },
  {
    id: "who_cancer_control_early_detection_2007",
    title: "Cancer Control: Knowledge into Action — Module 3: Early Detection",
    pageUrl: "https://screening.iarc.fr/doc/Early%20Detection%20Module%203.pdf",
    pdfUrls: ["https://screening.iarc.fr/doc/Early%20Detection%20Module%203.pdf"],
    year: 2007,
    topics: ["early_detection", "screening", "early_diagnosis", "program_design"],
    cancerTypes: ["general"],
    audienceLevel: "technical",
    publicationDate: "2007-01-01",
    citation: "World Health Organization. Cancer Control: Knowledge into Action — Module 3: Early Detection. Geneva: World Health Organization; 2007.",
  },
  {
    id: "who_palliative_care_planning_2016",
    title: "Planning and implementing palliative care services: a guide for programme managers",
    pageUrl: "https://iris.who.int/bitstream/handle/10665/250584/9789241565417-eng.pdf?sequence=1",
    pdfUrls: [
      "https://iris.who.int/bitstream/handle/10665/250584/9789241565417-eng.pdf?sequence=1",
    ],
    year: 2016,
    topics: ["palliative_care", "symptom_relief", "referral", "navigation"],
    cancerTypes: ["general"],
    audienceLevel: "technical",
    publicationDate: "2016-01-01",
    citation: "World Health Organization. Planning and implementing palliative care services: a guide for programme managers. Geneva: World Health Organization; 2016.",
  },
  // Additional cancer PDFs from non-IRIS hosts (download-friendly)
  {
    id: "who_national_cancer_screening_guidelines_2024",
    title: "National Cancer Screening and Early Diagnosis Guidelines (Second Edition, 2024)",
    pageUrl: "https://www.afro.who.int/sites/default/files/2025-03/National%20Cancer%20Screening%20Guidelines%202024.pdf",
    pdfUrls: [
      "https://www.afro.who.int/sites/default/files/2025-03/National%20Cancer%20Screening%20Guidelines%202024.pdf",
    ],
    year: 2024,
    topics: ["screening", "early_diagnosis", "cervical", "breast", "colorectal", "referral"],
    cancerTypes: ["cervical", "breast", "colorectal", "prostate", "oral", "general"],
    audienceLevel: "technical",
    publicationDate: "2024-01-01",
    citation: "Ministry of Health Kenya / WHO AFRO. National Cancer Screening and Early Diagnosis Guidelines, Second Edition. 2024.",
  },
  {
    id: "who_breast_cancer_handbook_iarc_2002",
    title: "IARC Handbooks of Cancer Prevention Volume 7: Breast Cancer Screening",
    pageUrl: "https://screening.iarc.fr/doc/Handbook7_Breast.pdf",
    pdfUrls: ["https://screening.iarc.fr/doc/Handbook7_Breast.pdf"],
    year: 2002,
    topics: ["breast_cancer", "screening", "early_detection"],
    cancerTypes: ["breast"],
    audienceLevel: "technical",
    publicationDate: "2002-01-01",
    citation: "IARC. Breast Cancer Screening. IARC Handbooks of Cancer Prevention, Vol. 7. Lyon: IARC; 2002.",
  },
  {
    id: "who_colorectal_cancer_screening_iarc_2019",
    title: "IARC Handbooks of Cancer Prevention Volume 17: Colorectal Cancer Screening",
    pageUrl: "https://publications.iarc.fr/Book-And-Report-Series/Iarc-Handbooks-Of-Cancer-Prevention/Colorectal-Cancer-Screening-2019",
    pdfUrls: [
      "https://publications.iarc.fr/_publications/media/download/5712/535af2201047a9b7c7a63f47d736e0c1750e3c3f.pdf",
    ],
    year: 2019,
    topics: ["colorectal_cancer", "screening", "early_detection"],
    cancerTypes: ["colorectal"],
    audienceLevel: "technical",
    publicationDate: "2019-01-01",
    citation: "IARC. Colorectal Cancer Screening. IARC Handbooks of Cancer Prevention, Vol. 17. Lyon: IARC; 2019.",
  },
  {
    id: "who_hpv_cervical_screening_manual_paho",
    title: "Using HPV tests for cervical cancer screening and managing HPV-positive women – A practical manual",
    pageUrl: "https://www.paho.org/en/documents/using-hpv-tests-cervical-cancer-screening-and-managing-hpv-positive-women-practical",
    pdfUrls: ["https://www.paho.org/sites/default/files/manual-VPH-English-01.pdf"],
    year: 2016,
    topics: ["cervical_cancer", "hpv", "screening", "early_detection"],
    cancerTypes: ["cervical"],
    audienceLevel: "technical",
    publicationDate: "2016-01-01",
    citation: "PAHO/WHO. Using HPV tests for cervical cancer screening and managing HPV-positive women. Washington: PAHO; 2016.",
  },
];

function parseArgs(): CliOpts {
  const args = process.argv.slice(2);
  const get = (k: string, def?: string) => {
    const i = args.indexOf(k);
    return i === -1 ? def : args[i + 1];
  };
  const flag = (k: string) => args.includes(k);

  return {
    outputDir: get("--outputDir", "kb_sources/who")!,
    kbRoot: get("--kbRoot", "kb")!,
    delayMs: Number(get("--delay", "30000")) || 30000, // default 30s between requests
    dryRun: flag("--dryRun"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadPdf(
  url: string,
  outPath: string,
  maxRetries = 3
): Promise<boolean> {
  // IRIS links sometimes return 403, so we use a realistic browser user-agent
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 120_000,
        headers: {
          "User-Agent": userAgent,
          Accept: "application/pdf,application/octet-stream,*/*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.who.int/",
        },
        maxRedirects: 10, // IRIS may redirect
        validateStatus: (status) => status >= 200 && status < 400,
      });

      // Reject HTML / non-PDF (e.g. IRIS bot-detection page)
      const contentType = (res.headers["content-type"] || "").toLowerCase();
      const magic = res.data.length >= 4 ? res.data.slice(0, 4).toString() : "";
      const isPdf = magic === "%PDF" && !contentType.includes("text/html");
      if (!isPdf) {
        console.warn(
          `  ⚠️ Response is not a PDF (content-type: ${contentType}, magic: ${magic || "none"}). Likely bot detection – try next URL or download manually.`
        );
        return false; // Do not save; caller will try next URL
      }

      const dir = path.dirname(outPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(outPath, res.data);
      console.log(`  ✓ Downloaded ${(res.data.length / 1024 / 1024).toFixed(2)} MB`);
      return true;
    } catch (err: any) {
      const is403 = err.response?.status === 403;
      const isRetryable =
        is403 || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";

      if (is403 && attempt < maxRetries - 1) {
        console.warn(
          `  ⚠️ 403 Forbidden (attempt ${attempt + 1}/${maxRetries}). IRIS may block automated access.`
        );
        console.warn(`  💡 Tip: You may need to download manually from: ${url}`);
        await sleep(5000 * (attempt + 1)); // Exponential backoff
        continue;
      }

      if (isRetryable && attempt < maxRetries - 1) {
        console.warn(`  ⚠️ Retryable error (attempt ${attempt + 1}/${maxRetries}): ${err.message}`);
        await sleep(3000 * (attempt + 1));
        continue;
      }

      console.error(`  ✗ Failed to download ${url}: ${err.message}`);
      if (err.response) {
        console.error(`    Status: ${err.response.status} ${err.response.statusText}`);
      }
      return false;
    }
  }

  return false;
}

async function main() {
  const opts = parseArgs();

  console.log(
    `WHO PDF downloader | docs=${WHO_DOCS.length} | outputDir=${opts.outputDir} | delayMs=${opts.delayMs} | dryRun=${opts.dryRun}`
  );

  const records: WHOIngestionRecord[] = [];

  for (let i = 0; i < WHO_DOCS.length; i++) {
    const doc = WHO_DOCS[i];
    console.log(`\n[${i + 1}/${WHO_DOCS.length}] ${doc.title}`);

    const pdfPath = path.join(opts.outputDir, `${doc.id}.pdf`);
    const sortedUrls = sortPdfUrlsPreferredFirst(doc.pdfUrls);

    let pdfUrlUsed: string | null = null;

    if (opts.dryRun) {
      console.log(`  ✓ Would try ${sortedUrls.length} URL(s) (preferred hosts first), save to ${pdfPath}`);
      pdfUrlUsed = sortedUrls[0];
    } else {
      for (let u = 0; u < sortedUrls.length; u++) {
        const url = sortedUrls[u];
        const host = hostOf(url);
        console.log(`  📥 Trying (${u + 1}/${sortedUrls.length}) ${host}...`);
        const ok = await downloadPdf(url, pdfPath);
        if (ok) {
          pdfUrlUsed = url;
          console.log(`  ✓ Saved PDF to ${pdfPath}`);
          break;
        }
        if (u < sortedUrls.length - 1) {
          console.log(`  ⏭️ Trying next URL...`);
        }
      }
      if (!pdfUrlUsed) {
        console.log(
          `  ⏭️ Skipping (no URL returned a valid PDF). Consider manual download from: ${doc.pageUrl}`
        );
        continue;
      }
    }

    const record: WHOIngestionRecord = {
      id: doc.id,
      page_url: doc.pageUrl,
      pdf_url: pdfUrlUsed,
      local_pdf_path: pdfPath,
      markdown_path: null,
      title: doc.title,
      year: doc.year,
      source: "World Health Organization",
      source_type: "03_who_public_health",
      language: "en",
      license: "CC BY-NC-SA 3.0 IGO",
      citation:
        doc.citation ||
        `World Health Organization. ${doc.title}. Geneva: World Health Organization; ${doc.year}.`,
      topics: doc.topics,
      cancer_types: doc.cancerTypes,
      audience_level: doc.audienceLevel,
      status: "active",
      publication_date: doc.publicationDate ?? null,
    };

    records.push(record);

    if (i < WHO_DOCS.length - 1 && !opts.dryRun) {
      console.log(`  ⏳ Waiting ${opts.delayMs}ms before next document...`);
      await sleep(opts.delayMs);
    }
  }

  const recordsPath = path.join("kb", "who_ingestion_records.json");

  if (opts.dryRun) {
    console.log(`\n✓ Dry run complete. Would write ${records.length} records to ${recordsPath}`);
  } else {
    if (!fs.existsSync("kb")) {
      fs.mkdirSync("kb", { recursive: true });
    }
    fs.writeFileSync(recordsPath, JSON.stringify(records, null, 2), "utf8");
    console.log(`\n✓ Wrote ${records.length} records to ${recordsPath}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

