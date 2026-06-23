-- Phase 2: FR-ROLE, FR-REVIEW, FR-KB-101 schema additions
-- Note: kbchunk_embedding_hnsw_idx is intentionally NOT dropped — managed outside Prisma.

-- DropIndex (FTS index — replaced by vector search)
DROP INDEX IF EXISTS "kb_chunk_content_tsv_idx";

-- DropIndex (isEval performance index — no longer defined in schema)
DROP INDEX IF EXISTS "Session_isEval_idx";

-- AlterTable KbChunk: remove FTS generated column
ALTER TABLE "KbChunk" DROP COLUMN IF EXISTS "content_tsv";

-- AlterTable KbDocument: Phase 2 FR-KB-101 fields
ALTER TABLE "KbDocument"
  ADD COLUMN IF NOT EXISTS "approvedUsageScope" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "reviewerName" TEXT,
  ADD COLUMN IF NOT EXISTS "riskCategory" TEXT;

-- AlterTable Session: Phase 2 FR-ROLE + FR-REVIEW fields
ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "reviewFlagReason" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewFlagged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reviewOutcome" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "userRole" TEXT NOT NULL DEFAULT 'unknown';

-- AlterTable VoiceInteraction: align id type with Prisma schema (uuid → text)
ALTER TABLE "VoiceInteraction" DROP CONSTRAINT "VoiceInteraction_pkey";
ALTER TABLE "VoiceInteraction" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "VoiceInteraction" ALTER COLUMN "id" SET DATA TYPE TEXT USING id::TEXT;
ALTER TABLE "VoiceInteraction" ADD CONSTRAINT "VoiceInteraction_pkey" PRIMARY KEY ("id");

-- CreateTable ReviewRecord (autoresearch quality engine)
CREATE TABLE IF NOT EXISTS "ReviewRecord" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "hardFailures" JSONB,
    "softFailures" JSONB,
    "ambiguousFlags" JSONB,
    "patchesApplied" JSONB,
    "originalResponse" TEXT,
    "reviewLatencyMs" INTEGER NOT NULL,
    "humanReviewStatus" TEXT,
    "humanReviewerId" TEXT,
    "humanReviewNote" TEXT,
    "humanReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable ReviewPolicy (autoresearch quality engine)
CREATE TABLE IF NOT EXISTS "ReviewPolicy" (
    "id" TEXT NOT NULL,
    "policyCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewRecord_messageId_key" ON "ReviewRecord"("messageId");
CREATE INDEX IF NOT EXISTS "ReviewRecord_sessionId_idx" ON "ReviewRecord"("sessionId");
CREATE INDEX IF NOT EXISTS "ReviewRecord_verdict_idx" ON "ReviewRecord"("verdict");
CREATE INDEX IF NOT EXISTS "ReviewRecord_humanReviewStatus_idx" ON "ReviewRecord"("humanReviewStatus");
CREATE INDEX IF NOT EXISTS "ReviewRecord_createdAt_idx" ON "ReviewRecord"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewPolicy_policyCode_key" ON "ReviewPolicy"("policyCode");

-- AddForeignKey (ReviewRecord → Message)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ReviewRecord_messageId_fkey'
  ) THEN
    ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
