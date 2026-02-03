/**
 * Evidence library config: single source of truth for folder ID, cutoff, and MIME allowlist.
 * Used by inventory (P1-02) and filters. Parsed once at app init.
 */

export interface EvidenceConfig {
  folderId: string | null;
  cutoffDate: Date | null;
  mimeAllowlist: string[];
}

const DEFAULT_MIME_ALLOWLIST = [
  "application/vnd.google-apps.document",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

/** Default cutoff: 2021-02-03 00:00:00 IST (last 5 years). */
const DEFAULT_CUTOFF_IST = "2021-02-03T00:00:00+05:30";

function parseCutoffIst(raw: string | undefined): Date | null {
  const value = raw?.trim() || DEFAULT_CUTOFF_IST;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? new Date(DEFAULT_CUTOFF_IST) : parsed;
}

function parseMimeAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return DEFAULT_MIME_ALLOWLIST;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getEvidenceConfig(env: {
  EVIDENCE_DRIVE_FOLDER_ID?: string;
  EVIDENCE_CUTOFF_IST?: string;
  EVIDENCE_MIME_ALLOWLIST?: string;
}): EvidenceConfig {
  return {
    folderId: env.EVIDENCE_DRIVE_FOLDER_ID?.trim() || null,
    cutoffDate: parseCutoffIst(env.EVIDENCE_CUTOFF_IST),
    mimeAllowlist: parseMimeAllowlist(env.EVIDENCE_MIME_ALLOWLIST),
  };
}
