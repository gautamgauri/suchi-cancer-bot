export type ArticleStatus = "draft" | "email_sent" | "approved" | "rejected";

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
