-- Add tenant isolation columns to EvidenceDocument
ALTER TABLE "EvidenceDocument" ADD COLUMN "orgId" TEXT;
ALTER TABLE "EvidenceDocument" ADD COLUMN "isGlobal" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: infer orgId from sourceFolder naming convention
UPDATE "EvidenceDocument"
SET "orgId" = CASE
  WHEN "sourceFolder" IN ('funding_library', 'diksha_fundraising') THEN 'diksha'
  WHEN "sourceFolder" ILIKE '%diksha%' OR "sourceFolder" ILIKE '%sccf%' OR "sourceFolder" ILIKE '%khel%' THEN 'diksha'
  WHEN "sourceFolder" ILIKE '%alok%' THEN 'alok'
  ELSE NULL
END;

-- Re-tag Alok docs that live in shared funding_library folder
UPDATE "EvidenceDocument"
SET "orgId" = 'alok'
WHERE "name" ILIKE '%alok%';

-- Mark known global sources
UPDATE "EvidenceDocument"
SET "isGlobal" = true
WHERE "sourceFolder" ILIKE '%who%'
   OR "sourceFolder" ILIKE '%unicef%'
   OR "sourceFolder" ILIKE '%nci%'
   OR "sourceFolder" ILIKE '%lancet%';

-- Index for org-scoped retrieval
CREATE INDEX "EvidenceDocument_orgId_idx" ON "EvidenceDocument" ("orgId");
