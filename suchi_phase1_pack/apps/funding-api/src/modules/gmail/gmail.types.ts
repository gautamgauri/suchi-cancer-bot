/**
 * Types for Gmail ingestion (Funding Bot).
 */

export interface GmailMessagePart {
  partId: string;
  mimeType?: string;
  filename?: string;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
}

export interface GmailMessagePayload {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    partId?: string;
    mimeType?: string;
    filename?: string;
    headers?: Array<{ name?: string; value?: string }>;
    body?: {
      attachmentId?: string;
      size?: number;
      data?: string;
    };
    parts?: GmailMessagePart[];
  };
}

export interface ParsedEmail {
  messageId: string;
  threadId: string;
  subject: string;
  from: { name?: string; email: string };
  to: string[];
  cc: string[];
  date: string;
  bodyPlain?: string;
  bodyHtml?: string;
  snippet?: string;
  attachmentIds: Array<{ attachmentId: string; filename?: string; mimeType?: string; size?: number }>;
}
