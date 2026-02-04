-- AlterTable PipelineEntry: add RFP fields for funding bot
ALTER TABLE "PipelineEntry" ADD COLUMN IF NOT EXISTS "deadline" TIMESTAMP(3);
ALTER TABLE "PipelineEntry" ADD COLUMN IF NOT EXISTS "submissionEmail" TEXT;
ALTER TABLE "PipelineEntry" ADD COLUMN IF NOT EXISTS "driveFolderUrl" TEXT;

-- CreateTable ProcessedEmail (idempotency for Gmail intake)
CREATE TABLE IF NOT EXISTS "ProcessedEmail" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opportunityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProcessedEmail_messageId_key" ON "ProcessedEmail"("messageId");
CREATE INDEX IF NOT EXISTS "ProcessedEmail_messageId_idx" ON "ProcessedEmail"("messageId");

-- CreateTable Opportunity
CREATE TABLE IF NOT EXISTS "Opportunity" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    "emailMessageId" TEXT,
    "threadId" TEXT,
    "driveFolderId" TEXT,
    "driveFolderUrl" TEXT,
    "jsonBlob" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "missingInputs" JSONB,
    "pipelineEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Opportunity_opportunityId_key" ON "Opportunity"("opportunityId");
CREATE UNIQUE INDEX IF NOT EXISTS "Opportunity_emailMessageId_key" ON "Opportunity"("emailMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "Opportunity_pipelineEntryId_key" ON "Opportunity"("pipelineEntryId");
CREATE INDEX IF NOT EXISTS "Opportunity_status_idx" ON "Opportunity"("status");
CREATE INDEX IF NOT EXISTS "Opportunity_emailMessageId_idx" ON "Opportunity"("emailMessageId");

-- CreateTable OpportunityAuditEvent
CREATE TABLE IF NOT EXISTS "OpportunityAuditEvent" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OpportunityAuditEvent_opportunityId_idx" ON "OpportunityAuditEvent"("opportunityId");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_pipelineEntryId_fkey" FOREIGN KEY ("pipelineEntryId") REFERENCES "PipelineEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OpportunityAuditEvent" ADD CONSTRAINT "OpportunityAuditEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
