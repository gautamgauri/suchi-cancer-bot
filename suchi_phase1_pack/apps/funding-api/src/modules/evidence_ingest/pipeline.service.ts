import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const DOC_TYPES = ["proposal", "concept_note", "report", "budget", "presentation", "mou", "misc"] as const;
type DocType = (typeof DOC_TYPES)[number];

/** Regex patterns for PII (Indian context): phone, email, bank-like, PAN, Aadhaar-like */
const PII_PATTERNS = {
  phone: /(\+91[\s-]?)?[6-9]\d{9}|\d{5}[\s-]\d{5}/g,
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  ifsc: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
  account: /\b\d{9,18}\b/g,
  pan: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
  aadhaarLike: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
};

function maskPii(text: string): { redacted: string; detected: boolean } {
  let redacted = text;
  let detected = false;
  for (const [, pattern] of Object.entries(PII_PATTERNS)) {
    if (pattern.test(text)) detected = true;
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return { redacted, detected };
}

function inferDocType(name: string, text: string): DocType {
  const lower = `${name} ${text}`.toLowerCase();
  if (/\b(proposal|grant\s+application)\b/.test(lower)) return "proposal";
  if (/\b(concept\s+note|concept note)\b/.test(lower)) return "concept_note";
  if (/\b(annual\s+report|progress\s+report|report)\b/.test(lower)) return "report";
  if (/\b(budget|financial|cost\s+breakdown)\b/.test(lower)) return "budget";
  if (/\b(presentation|deck|slides)\b/.test(lower) || lower.endsWith(".pptx")) return "presentation";
  if (/\b(mou|memorandum\s+of\s+understanding)\b/.test(lower)) return "mou";
  return "misc";
}

function inferProgram(name: string, text: string): string | null {
  const lower = `${name} ${text}`.toLowerCase();
  if (/\bkhel\b/.test(lower)) return "KHEL";
  if (/\bfellowship\b/.test(lower)) return "fellowship";
  if (/\blife\s+skills\b/.test(lower)) return "life_skills";
  return null;
}

function inferFunderName(name: string, text: string): string | null {
  const lower = `${name} ${text}`.slice(0, 2000);
  const match = lower.match(/\b(submitted\s+to|funder|donor|grant\s+from)\s*:?\s*([A-Za-z0-9\s&.,'-]+?)(?:\n|$|,)/i);
  return match ? match[2].trim().slice(0, 200) : null;
}

function computeQualityScore(doc: {
  cleanText: string | null;
  extractionStatus: string | null;
  needsOcr: boolean;
  docType: string | null;
  modifiedTime: Date;
}): { score: number; flags: string[] } {
  const flags: string[] = [];
  let cleanliness = 20;
  let relevance = 20;
  let freshness = 10;

  const textLen = (doc.cleanText ?? "").length;
  if (textLen < 200) {
    cleanliness -= 15;
    flags.push("low_text");
  } else if (textLen < 1000) cleanliness -= 5;
  if (doc.extractionStatus === "LOW_TEXT" || doc.needsOcr) {
    cleanliness -= 10;
    flags.push("needs_ocr");
  }

  const relTypes = ["proposal", "concept_note", "report", "budget"];
  if (doc.docType && relTypes.includes(doc.docType)) relevance = 40;
  else if (doc.docType && doc.docType !== "misc") relevance = 25;

  const ageMs = Date.now() - doc.modifiedTime.getTime();
  const years = ageMs / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 1) freshness = 20;
  else if (years < 3) freshness = 15;
  else if (years > 5) freshness = 5;

  const score = Math.max(0, Math.min(100, cleanliness + relevance + freshness));
  return { score, flags };
}

function tierFromScore(score: number): string {
  if (score >= 80) return "A";
  if (score >= 55) return "B";
  if (score >= 30) return "C";
  return "X";
}

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * P1-08: Group by checksum, set canonical_doc_id (exact duplicates). Only run on docs with checksum.
   */
  async detectDuplicates(): Promise<{ groups: number; canonicalSet: number }> {
    const docs = await this.prisma.evidenceDocument.findMany({
      where: { checksum: { not: null } },
      select: { id: true, driveFileId: true, checksum: true, modifiedTime: true },
    });
    const byChecksum = new Map<string, typeof docs>();
    for (const d of docs) {
      const c = d.checksum!;
      if (!byChecksum.has(c)) byChecksum.set(c, []);
      byChecksum.get(c)!.push(d);
    }
    let groups = 0;
    let canonicalSet = 0;
    for (const [, group] of byChecksum) {
      if (group.length < 2) continue;
      groups++;
      const sorted = [...group].sort(
        (a, b) => a.modifiedTime.getTime() - b.modifiedTime.getTime(),
      );
      const canonicalId = sorted[0].id;
      for (const doc of group) {
        const isCanonical = doc.id === canonicalId;
        const existing = await this.prisma.evidenceDocument.findUnique({
          where: { id: doc.id },
          select: { flags: true },
        });
        const existingFlags = (existing?.flags as string[] | null) ?? [];
        const flags = isCanonical ? existingFlags : [...new Set([...existingFlags, "duplicate"])];
        await this.prisma.evidenceDocument.update({
          where: { id: doc.id },
          data: { canonicalDocId: canonicalId, flags: flags as unknown as object },
        });
        canonicalSet++;
      }
    }
    const selfCanonical = await this.prisma.evidenceDocument.findMany({
      where: { canonicalDocId: null },
      select: { id: true },
    });
    for (const d of selfCanonical) {
      await this.prisma.evidenceDocument.update({
        where: { id: d.id },
        data: { canonicalDocId: d.id },
      });
    }
    this.logger.log(`Duplicates: ${groups} groups, ${canonicalSet} docs linked to canonical`);
    return { groups, canonicalSet };
  }

  /**
   * P1-09: Assign doc_type, program, funder_name from rules (filename + text).
   */
  async classifyDocTypes(): Promise<{ updated: number }> {
    const docs = await this.prisma.evidenceDocument.findMany({
      where: { cleanText: { not: null } },
      select: { id: true, name: true, cleanText: true },
    });
    let updated = 0;
    for (const doc of docs) {
      const text = doc.cleanText ?? "";
      const docType = inferDocType(doc.name, text);
      const program = inferProgram(doc.name, text);
      const funderName = inferFunderName(doc.name, text);
      await this.prisma.evidenceDocument.update({
        where: { id: doc.id },
        data: {
          docType,
          program: program ?? undefined,
          funderName: funderName ?? undefined,
        },
      });
      updated++;
    }
    this.logger.log(`Doc type classification: ${updated} docs updated`);
    return { updated };
  }

  /**
   * P1-10: Quality score, tier, flags, public_safe (default false for now).
   */
  async scoreQuality(): Promise<{ scored: number }> {
    const docs = await this.prisma.evidenceDocument.findMany({
      select: {
        id: true,
        cleanText: true,
        extractionStatus: true,
        needsOcr: true,
        docType: true,
        modifiedTime: true,
        flags: true,
      },
    });
    let scored = 0;
    for (const doc of docs) {
      const { score, flags } = computeQualityScore({
        cleanText: doc.cleanText,
        extractionStatus: doc.extractionStatus,
        needsOcr: doc.needsOcr,
        docType: doc.docType,
        modifiedTime: doc.modifiedTime,
      });
      const existingFlags = (doc.flags as string[] | null) ?? [];
      const allFlags = [...new Set([...existingFlags, ...flags])];
      const qualityTier = tierFromScore(score);
      await this.prisma.evidenceDocument.update({
        where: { id: doc.id },
        data: {
          qualityScore: score,
          qualityTier,
          flags: allFlags as unknown as object,
          publicSafe: false,
        },
      });
      scored++;
    }
    this.logger.log(`Quality scoring: ${scored} docs scored`);
    return { scored };
  }

  /**
   * P1-11: PII detection and clean_text_redacted.
   */
  async detectPii(): Promise<{ withPii: number }> {
    const docs = await this.prisma.evidenceDocument.findMany({
      where: { cleanText: { not: null } },
      select: { id: true, cleanText: true },
    });
    let withPii = 0;
    for (const doc of docs) {
      const text = doc.cleanText ?? "";
      const { redacted, detected } = maskPii(text);
      if (detected) withPii++;
      const sensitivityLevel = detected ? "med" : "low";
      await this.prisma.evidenceDocument.update({
        where: { id: doc.id },
        data: {
          piiDetected: detected,
          sensitivityLevel,
          cleanTextRedacted: detected ? redacted : undefined,
        },
      });
    }
    this.logger.log(`PII detection: ${withPii} docs with PII redacted`);
    return { withPii };
  }

  /**
   * Run full Phase 1 pipeline: duplicates → doc type → quality → PII.
   */
  async runPhase1Pipeline(): Promise<{
    duplicates: { groups: number; canonicalSet: number };
    docTypes: { updated: number };
    quality: { scored: number };
    pii: { withPii: number };
  }> {
    const duplicates = await this.detectDuplicates();
    const docTypes = await this.classifyDocTypes();
    const quality = await this.scoreQuality();
    const pii = await this.detectPii();
    return { duplicates, docTypes, quality, pii };
  }
}
