export type ArticleStatus =
  | "ai_draft"
  | "sent_for_review"
  | "approved"
  | "rejected"
  | "published"
  | "archived";

export interface ArticleEntry {
  slug: string;
  title: string;
  contentType: string;
  status: ArticleStatus;
  createdAt: string;
  emailSentAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  approvalToken?: string;
}

export interface ContentQueue {
  articles: ArticleEntry[];
}
