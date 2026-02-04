import { Injectable, Logger } from "@nestjs/common";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require("mammoth") as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// File size limits to prevent DoS
const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_DOCX_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_SIZE = 5 * 1024 * 1024; // 5MB

@Injectable()
export class RfpTextExtractService {
  private readonly logger = new Logger(RfpTextExtractService.name);

  /**
   * Extract plain text from RFP document buffer (PDF or DOCX).
   * Includes file size validation to prevent DoS attacks.
   */
  async extractText(mimeType: string, buffer: Buffer): Promise<string> {
    const mime = (mimeType || "").toLowerCase();

    try {
      if (mime === PDF_MIME) {
        if (buffer.length > MAX_PDF_SIZE) {
          this.logger.warn(`PDF exceeds max size: ${buffer.length} bytes (max: ${MAX_PDF_SIZE})`);
          return "";
        }
        const { text } = await pdfParse(buffer);
        return (text || "").trim();
      }
      if (mime === DOCX_MIME) {
        if (buffer.length > MAX_DOCX_SIZE) {
          this.logger.warn(`DOCX exceeds max size: ${buffer.length} bytes (max: ${MAX_DOCX_SIZE})`);
          return "";
        }
        const result = await mammoth.extractRawText({ buffer });
        return (result.value || "").trim();
      }
      if (mime.startsWith("text/")) {
        if (buffer.length > MAX_TEXT_SIZE) {
          this.logger.warn(`Text file exceeds max size: ${buffer.length} bytes (max: ${MAX_TEXT_SIZE})`);
          return "";
        }
        return buffer.toString("utf-8").trim();
      }
      this.logger.warn(`Unsupported RFP mime type: ${mimeType}`);
      return "";
    } catch (e) {
      this.logger.error(`Failed to extract text from ${mimeType}`, (e as Error).message);
      return "";
    }
  }
}
