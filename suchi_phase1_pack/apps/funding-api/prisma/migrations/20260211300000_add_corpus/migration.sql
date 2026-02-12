-- AlterTable: add corpus column
ALTER TABLE "EvidenceDocument" ADD COLUMN "corpus" TEXT;

-- CreateIndex
CREATE INDEX "EvidenceDocument_corpus_idx" ON "EvidenceDocument"("corpus");

-- Backfill: classify existing documents into corpora

-- Rule 1: funder/donor docs
UPDATE "EvidenceDocument"
SET "corpus" = 'donor_funder'
WHERE "sourceFolder" ILIKE '%funder%'
   OR "sourceFolder" ILIKE '%donor%'
   OR "name" ILIKE '%rfp%'
   OR "name" ILIKE '%call for%'
   OR "docType" IN ('rfp', 'funder_guidelines');

-- Rule 2: theory/frameworks
UPDATE "EvidenceDocument"
SET "corpus" = 'theory_frameworks'
WHERE "corpus" IS NULL
  AND ("sourceFolder" ILIKE '%theory%'
       OR "sourceFolder" ILIKE '%framework%'
       OR "sourceFolder" ILIKE '%research%'
       OR "name" ILIKE '%see learning%'
       OR "name" ILIKE '%nep%'
       OR "name" ILIKE '%pedagogy%');

-- Rule 3: external evidence
UPDATE "EvidenceDocument"
SET "corpus" = 'external_evidence'
WHERE "corpus" IS NULL
  AND ("sourceFolder" ILIKE '%external%'
       OR "sourceFolder" ILIKE '%nci%'
       OR "sourceFolder" ILIKE '%who%'
       OR "sourceFolder" ILIKE '%aser%'
       OR "name" ILIKE '%census%'
       OR "name" ILIKE '%survey%');

-- Rule 4: default remaining to internal
UPDATE "EvidenceDocument"
SET "corpus" = 'diksha_internal'
WHERE "corpus" IS NULL;
