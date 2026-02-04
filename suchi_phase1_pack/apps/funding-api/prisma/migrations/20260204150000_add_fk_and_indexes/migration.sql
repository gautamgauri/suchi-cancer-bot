-- Add foreign key constraint on ProcessedEmail.opportunityId
-- This ensures referential integrity between ProcessedEmail and Opportunity
ALTER TABLE "ProcessedEmail"
ADD CONSTRAINT "ProcessedEmail_opportunityId_fkey"
FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add missing indexes on Opportunity table for common query patterns
CREATE INDEX IF NOT EXISTS "Opportunity_opportunityId_idx" ON "Opportunity"("opportunityId");
CREATE INDEX IF NOT EXISTS "Opportunity_createdAt_idx" ON "Opportunity"("createdAt");
CREATE INDEX IF NOT EXISTS "Opportunity_pipelineEntryId_idx" ON "Opportunity"("pipelineEntryId");
