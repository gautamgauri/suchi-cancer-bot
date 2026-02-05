-- CreateTable ProposalRun
CREATE TABLE "ProposalRun" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "modelConfig" JSONB NOT NULL,
    "outline" JSONB,
    "retrievalPlan" JSONB,
    "complianceReport" JSONB,
    "artifacts" JSONB,
    "gaps" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProposalRun_opportunityId_idx" ON "ProposalRun"("opportunityId");
CREATE INDEX "ProposalRun_status_idx" ON "ProposalRun"("status");

-- CreateTable ProposalSection
CREATE TABLE "ProposalSection" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetWords" INTEGER,
    "retrievalQueries" JSONB,
    "retrievedChunks" JSONB,
    "draftText" TEXT,
    "citations" JSONB,
    "gaps" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalSection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProposalSection_runId_idx" ON "ProposalSection"("runId");

-- AddForeignKey
ALTER TABLE "ProposalRun" ADD CONSTRAINT "ProposalRun_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalSection" ADD CONSTRAINT "ProposalSection_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProposalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
