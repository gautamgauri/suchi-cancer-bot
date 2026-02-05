import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;

export type IngestSourceType = "foundational" | "method_source" | "pattern_source" | "comparable_source";

export interface IngestFromUrlResult {
  ok: boolean;
  text: string;
  textLength: number;
  contentType: string;
  rawPath?: string;
  error?: string;
}

/**
 * Fetches content from URL and extracts plain text.
 * For PDF: uses pdf-parse. For HTML: strips tags to get text.
 * Optionally stores raw bytes to a temp file (for audit).
 */
@Injectable()
export class CardIngesterService {
  private readonly logger = new Logger(CardIngesterService.name);

  /**
   * Fetch URL and return response buffer and content-type.
   */
  async fetchUrl(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    const res = await fetch(url, {
      headers: { "User-Agent": "FundingBot/1.0 (Framework Ingest)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    return { buffer, contentType };
  }

  /**
   * Extract plain text from buffer. Supports PDF and HTML.
   */
  async extractText(buffer: Buffer, contentType: string): Promise<string> {
    if (contentType.includes("pdf")) {
      const data = await pdfParse(buffer);
      return (data?.text ?? "").trim();
    }
    if (contentType.includes("html") || contentType.includes("text")) {
      const str = buffer.toString("utf-8");
      return this.htmlToPlainText(str);
    }
    this.logger.warn(`Unsupported content-type for text extraction: ${contentType}`);
    return buffer.toString("utf-8").trim();
  }

  private htmlToPlainText(html: string): string {
    return html
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Ingest from URL: fetch -> (optional) store raw -> extract text.
   * Returns extracted text and optionally path to stored raw file.
   */
  async ingestFromUrl(
    url: string,
    options: { storeRaw?: boolean } = {},
  ): Promise<IngestFromUrlResult> {
    try {
      const { buffer, contentType } = await this.fetchUrl(url);
      let rawPath: string | undefined;
      if (options.storeRaw) {
        const dir = path.join(os.tmpdir(), "framework_ingest");
        await fs.mkdir(dir, { recursive: true });
        const ext = contentType.includes("pdf") ? "pdf" : "html";
        rawPath = path.join(dir, `${Date.now()}-${Buffer.from(url).toString("base64").slice(0, 20)}.${ext}`);
        await fs.writeFile(rawPath, buffer);
      }
      const text = await this.extractText(buffer, contentType);
      return { ok: true, text, textLength: text.length, contentType, rawPath };
    } catch (e) {
      const err = e as Error;
      this.logger.warn(`Ingest failed for ${url}: ${err.message}`);
      return { ok: false, text: "", textLength: 0, contentType: "", error: err.message };
    }
  }
}
