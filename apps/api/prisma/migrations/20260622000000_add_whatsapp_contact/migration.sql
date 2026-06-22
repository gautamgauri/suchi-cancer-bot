-- §16 / FR-WA-008: WhatsApp conversational channel phone→session mapping.
-- Idempotent so it is safe to re-run via the gated pipeline's repair path.

CREATE TABLE IF NOT EXISTS "WhatsAppContact" (
  "waId"         TEXT NOT NULL,
  "sessionId"    TEXT NOT NULL,
  "locale"       TEXT,
  "lastActiveAt" TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WhatsAppContact_pkey" PRIMARY KEY ("waId")
);

CREATE INDEX IF NOT EXISTS "WhatsAppContact_lastActiveAt_idx" ON "WhatsAppContact" ("lastActiveAt");
