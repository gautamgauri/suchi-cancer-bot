/**
 * Opportunity Application Assistant — Type definitions.
 *
 * This module handles personal/org applications to fellowships, accelerators,
 * and conferences (where Gautam is the applicant). Separate from the grant
 * proposal pipeline in the `opportunity` module.
 */

// ─── Applicant Profile (loaded from data/applicant-profile.json) ──────────

export interface ApplicantIdentity {
  full_name: string;
  location: string;
  email_primary: string;
  phone: string;
  linkedin_url: string;
  website_urls: string[];
}

export interface ApplicantRole {
  title: string;
  org: string;
  summary_1line: string;
  start_year?: number;
}

export interface ApplicantEducation {
  institution: string;
  program: string;
  years: string;
}

export interface ApplicantProject {
  name: string;
  type: string;
  what_it_does?: string;
  target?: string;
  pilot_size?: number;
  stack?: string[];
}

export interface ApplicantLeader {
  name: string;
  role: string;
  qualifications: string;
}

export interface ApplicantSnippets {
  why_me_120w: string;
  why_this_program_150w: string;
  my_work_200w: string;
  ai_story_200w: string;
  bio_50w: string;
  bio_100w: string;
  bio_200w: string;
  [key: string]: string; // allow custom snippets
}

export interface ApplicantReference {
  name: string;
  title: string;
  org: string;
  email: string;
}

export interface ApplicantProfile {
  schemaVersion: string;
  identity: ApplicantIdentity;
  roles: ApplicantRole[];
  education: ApplicantEducation[];
  core_interests: string[];
  signature_projects: ApplicantProject[];
  frameworks: string[];
  metrics_and_credibility: Record<string, unknown>;
  leadership_team: ApplicantLeader[];
  board_of_directors: ApplicantLeader[];
  funding_partners: { current: string[]; past: string[] };
  snippets: ApplicantSnippets;
  references: ApplicantReference[];
}

// ─── Opportunity Application Record ───────────────────────────────────────

export type ApplicationStatus =
  | "intake"         // URL pasted, being extracted
  | "triaged"        // fit/effort/deadline scored
  | "questions_extracted" // form questions extracted
  | "drafting"       // answers being generated
  | "review"         // answers ready for human review
  | "approved"       // human approved the answer pack
  | "prefilling"     // browser runner active
  | "prefilled"      // form fields filled, awaiting manual submit
  | "submitted"      // human confirmed submission
  | "archived";      // archived post-decision

export type FitLevel = "strong" | "moderate" | "weak" | "unknown";
export type EffortLevel = "low" | "medium" | "high";
export type AnswerConfidence = "high" | "medium" | "low" | "needs_human";

export interface ApplicationQuestion {
  id: string;            // q_1, q_2, ...
  questionText: string;
  fieldType: "text" | "textarea" | "select" | "radio" | "checkbox" | "file_upload" | "date" | "number" | "unknown";
  wordLimit?: number;
  charLimit?: number;
  required: boolean;
  options?: string[];    // for select/radio/checkbox
  sectionLabel?: string; // which form section it belongs to
}

export interface DraftedAnswer {
  questionId: string;
  questionText: string;
  answerText: string;
  wordCount: number;
  charCount: number;
  wordLimit?: number;
  charLimit?: number;
  withinLimit: boolean;
  confidence: AnswerConfidence;
  sourceSnippets: string[];  // which profile snippets were used
  notes: string;             // for reviewer — e.g. "used bio_100w + customized for AI focus"
}

export interface ApplicationTriage {
  fitLevel: FitLevel;
  fitReasons: string[];
  effortLevel: EffortLevel;
  estimatedQuestions: number;
  deadline: string | null;
  relevanceThemes: string[];
  recommendation: string;  // e.g. "Strong fit — apply. 12 questions, ~2hr effort."
}

export interface PrefillResult {
  fieldsFilled: number;
  fieldsSkipped: number;
  skippedReasons: string[];  // e.g. "CAPTCHA detected", "login required", "file upload"
  screenshotPath?: string;
  fillLog: PrefillFieldLog[];
}

export interface PrefillFieldLog {
  questionId: string;
  selector: string;
  action: "filled" | "skipped" | "error";
  reason?: string;
}

// ─── Slack Command DTOs ──────────────────────────────────────────────────

export interface OppAddRequest {
  url: string;
  notes?: string;
  owner?: string;
}

export interface OppTriageResponse {
  applicationId: string;
  triage: ApplicationTriage;
}

export interface OppDraftResponse {
  applicationId: string;
  totalQuestions: number;
  draftedCount: number;
  needsHumanCount: number;
  driveFolderUrl?: string;
}

export interface OppReviseRequest {
  applicationId: string;
  questionId?: string;  // if omitted, revise all
  instructions: string; // e.g. "make it more technical; 150 words"
}

export interface OppStatusResponse {
  applicationId: string;
  status: ApplicationStatus;
  programName: string;
  deadline: string | null;
  owner: string;
  questionsTotal: number;
  questionsDrafted: number;
  questionsApproved: number;
  timeline: ApplicationTimelineEvent[];
}

export interface ApplicationTimelineEvent {
  timestamp: string;
  action: string;
  actor: string;
  details?: string;
}

// ─── Full Application Document (stored as JSON in DB) ─────────────────────

export interface ApplicationDocument {
  schemaVersion: string;
  applicationId: string;
  sourceUrl: string;
  programName: string;
  organizerName: string;
  opportunityType: "fellowship" | "accelerator" | "conference" | "award" | "grant" | "other";
  deadline: string | null;
  status: ApplicationStatus;
  triage?: ApplicationTriage;
  questions: ApplicationQuestion[];
  answers: DraftedAnswer[];
  prefillResult?: PrefillResult;
  driveFolderId?: string;
  driveFolderUrl?: string;
  owner: string;
  reviewer?: string;
  timeline: ApplicationTimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

// ─── JSON Blob Helpers ────────────────────────────────────────────────────

/**
 * Safely push a timeline event to a jsonBlob, initializing the array if missing.
 * Prevents crashes from malformed or externally-created blobs.
 */
export function pushTimelineEvent(
  jsonBlob: Record<string, unknown>,
  event: Record<string, unknown>,
): void {
  if (!Array.isArray(jsonBlob.timeline)) {
    jsonBlob.timeline = [];
  }
  (jsonBlob.timeline as Array<Record<string, unknown>>).push(event);
}
