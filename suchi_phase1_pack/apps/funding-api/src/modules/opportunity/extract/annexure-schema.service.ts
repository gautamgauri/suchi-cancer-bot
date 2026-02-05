import { Injectable, Logger } from "@nestjs/common";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require("xlsx") as {
  read: (buffer: Buffer, opts: { type: string }) => { SheetNames: string[]; Sheets: Record<string, { "!ref"?: string; [key: string]: unknown }> };
  utils: {
    decode_range: (ref: string) => { s: { r: number; c: number }; e: { r: number; c: number } };
    encode_cell: (obj: { r: number; c: number }) => string;
  };
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

// File size and structure limits to prevent DoS
const MAX_XLSX_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_SHEETS = 50;
const MAX_COLUMNS = 500;

export interface SheetSchema {
  sheetName: string;
  headers: string[];
  rowCount: number;
}

@Injectable()
export class AnnexureSchemaService {
  private readonly logger = new Logger(AnnexureSchemaService.name);

  isSpreadsheet(mimeType: string): boolean {
    const m = (mimeType || "").toLowerCase();
    return m === XLSX_MIME || m === XLS_MIME || m.includes("spreadsheet");
  }

  /**
   * Parse XLSX/XLS buffer and return first sheet's column headers and row count.
   * Includes size and structure limits to prevent DoS attacks.
   */
  parseSheetSchema(buffer: Buffer): SheetSchema[] {
    const result: SheetSchema[] = [];

    // File size check
    if (buffer.length > MAX_XLSX_SIZE) {
      this.logger.warn(`Spreadsheet exceeds max size: ${buffer.length} bytes (max: ${MAX_XLSX_SIZE})`);
      return result;
    }

    try {
      const workbook = XLSX.read(buffer, { type: "buffer" });

      // Sheet count limit
      const sheetNames = workbook.SheetNames.slice(0, MAX_SHEETS);
      if (workbook.SheetNames.length > MAX_SHEETS) {
        this.logger.warn(`Spreadsheet has ${workbook.SheetNames.length} sheets, limiting to ${MAX_SHEETS}`);
      }

      for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const ref = sheet["!ref"];
        const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
        const rowCount = Math.max(0, range.e.r - range.s.r + 1);
        const headers: string[] = [];
        const firstRow = range.s.r;

        // Column count limit
        const maxCol = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1);
        if (range.e.c > maxCol) {
          this.logger.warn(`Sheet ${sheetName} has ${range.e.c - range.s.c + 1} columns, limiting to ${MAX_COLUMNS}`);
        }

        for (let c = range.s.c; c <= maxCol; c++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: firstRow, c })] as { w?: string; v?: unknown } | undefined;
          const value = cell?.w ?? (cell?.v != null ? String(cell.v) : "");
          // Limit header length to prevent memory issues
          headers.push(String(value).trim().slice(0, 500));
        }
        result.push({ sheetName, headers, rowCount });
      }
    } catch (e) {
      this.logger.warn("Annexure parse failed", (e as Error).message);
    }
    return result;
  }
}
