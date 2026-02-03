-- AlterTable EvidenceDocument: add access control, structured metadata, public_safe, indexes
ALTER TABLE "EvidenceDocument" ADD COLUMN IF NOT EXISTS "sharedWithDomain" TEXT;
ALTER TABLE "EvidenceDocument" ADD COLUMN IF NOT EXISTS "permissionsSummary" JSONB;
ALTER TABLE "EvidenceDocument" ADD COLUMN IF NOT EXISTS "visibilityScope" TEXT;
ALTER TABLE "EvidenceDocument" ADD COLUMN IF NOT EXISTS "program" TEXT;
ALTER TABLE "EvidenceDocument" ADD COLUMN IF NOT EXISTS "geography" TEXT;
ALTER TABLE "EvidenceDocument" ADD COLUMN IF NOT EXISTS "docPurpose" TEXT;
ALTER TABLE "EvidenceDocument" ADD COLUMN IF NOT EXISTS "funderName" TEXT;
ALTER TABLE "EvidenceDocument" ADD COLUMN IF NOT EXISTS "publicSafe" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex (only if not exists - PostgreSQL doesn't support IF NOT EXISTS for indexes in all versions, so we use simple CREATE INDEX)
CREATE INDEX IF NOT EXISTS "EvidenceDocument_sourceFolder_idx" ON "EvidenceDocument"("sourceFolder");
CREATE INDEX IF NOT EXISTS "EvidenceDocument_needsProcessing_idx" ON "EvidenceDocument"("needsProcessing");
CREATE INDEX IF NOT EXISTS "EvidenceDocument_qualityTier_idx" ON "EvidenceDocument"("qualityTier");
CREATE INDEX IF NOT EXISTS "EvidenceDocument_visibilityScope_idx" ON "EvidenceDocument"("visibilityScope");

-- CreateTable IngestRun (run logs for observability)
CREATE TABLE IF NOT EXISTS "IngestRun" (
    "id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "countsIndexed" INTEGER DEFAULT 0,
    "countsExtracted" INTEGER DEFAULT 0,
    "countsScored" INTEGER DEFAULT 0,
    "errorTypes" JSONB,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);
