/**
 * Suchi Navigator — Types
 *
 * Research targets are batches of candidate hospitals for a given region.
 * Drafted hospitals await human review/approval before being added to hospitals.json.
 */

export type BatchStatus =
  | "pending"
  | "researched"
  | "email_sent"
  | "approved"
  | "rejected";

export interface ResearchTarget {
  id: string;             // e.g. "jharkhand-batch-1"
  region: string;         // e.g. "Jharkhand"
  status: BatchStatus;
  hospitals: HospitalDraft[];
  createdAt: string;
  emailSentAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalToken?: string;
}

export interface HospitalDraft {
  // Matches the hospitals.json schema — marked draft until human approval
  id: string;
  name: string;
  short_name: string;
  city: string;
  state: string;
  region: string;
  type: string;
  accreditation: string[];
  ncg_member: boolean | null;
  departments: string[];
  cost_tier: string | null;
  pmjay_empanelled: boolean | null;
  contact: {
    phone: string | null;
    address: string | null;
    website?: string | null;
  };
  key_doctors: Array<{ name: string; role: string }>;
  notes: string;
  tier: "A" | "B" | "C" | "D" | null;
  navigation_notes: string[];
  score: number | null;
  verified_date: string;
  status: "draft";
  confidence: "high" | "medium" | "low"; // researcher's confidence in the data
  sources: string[];                      // URLs or source descriptions used
}
