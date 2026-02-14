-- CreateTable FunderOrg
CREATE TABLE "FunderOrg" (
    "id" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "orgWebsite" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastRunAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunderOrg_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FunderOrg_network_idx" ON "FunderOrg"("network");
CREATE INDEX "FunderOrg_status_idx" ON "FunderOrg"("status");
CREATE INDEX "FunderOrg_createdAt_idx" ON "FunderOrg"("createdAt");

-- CreateTable FunderFact
CREATE TABLE "FunderFact" (
    "id" TEXT NOT NULL,
    "funderOrgId" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "orgWebsite" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "funderName" TEXT,
    "funderType" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "evidenceExcerpt" TEXT NOT NULL,
    "evidenceUrl" TEXT NOT NULL,
    "financialAmount" TEXT,
    "grantYears" TEXT,
    "programFocus" TEXT,
    "geography" TEXT,
    "confidenceScore" TEXT NOT NULL,
    "notes" TEXT,
    "normalizedFunder" TEXT,
    "matchConfidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunderFact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FunderFact_funderOrgId_idx" ON "FunderFact"("funderOrgId");
CREATE INDEX "FunderFact_normalizedFunder_idx" ON "FunderFact"("normalizedFunder");
CREATE INDEX "FunderFact_funderType_idx" ON "FunderFact"("funderType");
CREATE INDEX "FunderFact_confidenceScore_idx" ON "FunderFact"("confidenceScore");

-- AddForeignKey
ALTER TABLE "FunderFact" ADD CONSTRAINT "FunderFact_funderOrgId_fkey" FOREIGN KEY ("funderOrgId") REFERENCES "FunderOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
