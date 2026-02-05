import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import * as fs from "fs/promises";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ numpages: number; text: string }>;

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const PDF_MIME = "application/pdf";
const MIN_TEXT_LENGTH = 50;
const PDF_LOW_TEXT_THRESHOLD = 500;

/**
 * Normalize and cleanup text (P1-07): whitespace, repeated header/footer lines, preserve headings.
 */
function normalizeCleanText(text: string): string {
  if (!text?.trim()) return text || "";
  let out = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  const lines = out.split("\n");
  const seen = new Map<string, number>();
  const deduped: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      deduped.push("");
      continue;
    }
    const count = (seen.get(t) ?? 0) + 1;
    seen.set(t, count);
    if (count <= 2) deduped.push(line);
  }
  return deduped.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Convert HTML from Google Docs export to plain text, preserving headings and structure.
 */
function htmlToPlainText(html: string): string {
  let text = html
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const headingCount = (html.match(/<h[1-6][^>]*>/gi) ?? []).length;
  return lines.join("\n\n");
}

@Injectable()
export class ExtractService {
  private readonly logger = new Logger(ExtractService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extract text from Google Docs (HTML files). Docs with download_status success and no rawText yet.
   */
  async extractGoogleDocs(): Promise<{ success: number; failed: number; lowText: number }> {
    const docs = await this.prisma.evidenceDocument.findMany({
      where: {
        mimeType: GOOGLE_DOC_MIME,
        downloadStatus: "success",
        rawStorageUri: { not: null },
      },
    });
    let success = 0;
    let failed = 0;
    let lowText = 0;

    for (const doc of docs) {
      const uri = doc.rawStorageUri!;
      try {
        const content = await fs.readFile(uri, "utf-8");
        const rawText = htmlToPlainText(content);
        const status = rawText.length < MIN_TEXT_LENGTH ? "LOW_TEXT" : "success";
        if (status === "LOW_TEXT") lowText++;
        else success++;

        const headingCount = (content.match(/<h[1-6][^>]*>/gi) ?? []).length;
        const cleanText = normalizeCleanText(rawText);
        await this.prisma.evidenceDocument.update({
          where: { id: doc.id },
          data: {
            rawText,
            cleanText,
            extractionMeta: {
              length: rawText.length,
              heading_count: headingCount,
            },
            extractionStatus: status,
          },
        });
      } catch (e) {
        failed++;
        this.logger.warn(`Extract failed for ${doc.driveFileId}: ${(e as Error).message}`);
        await this.prisma.evidenceDocument.update({
          where: { id: doc.id },
          data: {
            extractionStatus: "failed",
            extractionMeta: { error: (e as Error).message },
          },
        });
      }
    }

    this.logger.log(`Google Docs extraction: ${success} success, ${lowText} low_text, ${failed} failed`);
    return { success, failed, lowText };
  }

  /**
   * Extract text from PDFs. Sets needsOcr=true and extraction_status=LOW_TEXT when text length < threshold.
   */
  async extractPdfs(): Promise<{ success: number; failed: number; needsOcr: number }> {
    const docs = await this.prisma.evidenceDocument.findMany({
      where: {
        mimeType: PDF_MIME,
        downloadStatus: "success",
        rawStorageUri: { not: null },
      },
    });
    let success = 0;
    let failed = 0;
    let needsOcr = 0;

    for (const doc of docs) {
      const uri = doc.rawStorageUri!;
      try {
        const buffer = await fs.readFile(uri);
        const { text, numpages } = await pdfParse(buffer);
        const rawText = (text || "").trim();
        const isLowText = rawText.length < PDF_LOW_TEXT_THRESHOLD;
        if (isLowText) needsOcr++;
        else success++;

        const cleanText = normalizeCleanText(rawText);
        await this.prisma.evidenceDocument.update({
          where: { id: doc.id },
          data: {
            rawText,
            cleanText,
            extractionMeta: { length: rawText.length, numpages },
            extractionStatus: isLowText ? "LOW_TEXT" : "success",
            needsOcr: isLowText,
          },
        });
      } catch (e) {
        failed++;
        this.logger.warn(`PDF extract failed for ${doc.driveFileId}: ${(e as Error).message}`);
        await this.prisma.evidenceDocument.update({
          where: { id: doc.id },
          data: {
            extractionStatus: "failed",
            extractionMeta: { error: (e as Error).message },
          },
        });
      }
    }

    this.logger.log(`PDF extraction: ${success} success, ${needsOcr} needs_ocr, ${failed} failed`);
    return { success, failed, needsOcr };
  }

  /**
   * Re-run normalization on all docs that have rawText (P1-07).
   */
  async normalizeAll(): Promise<{ updated: number }> {
    const docs = await this.prisma.evidenceDocument.findMany({
      where: { rawText: { not: null } },
    });
    let updated = 0;
    for (const doc of docs) {
      const raw = doc.rawText ?? "";
      const clean = normalizeCleanText(raw);
      if (clean !== (doc.cleanText ?? "")) {
        await this.prisma.evidenceDocument.update({
          where: { id: doc.id },
          data: { cleanText: clean },
        });
        updated++;
      }
    }
    this.logger.log(`Normalize: ${updated} documents updated`);
    return { updated };
  }
}
