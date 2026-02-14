-- CreateTable
CREATE TABLE "GovernanceAuditEntry" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actor" JSONB NOT NULL,
    "reason" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "preview" JSONB,
    "approval" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernanceAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceAuditEntry_eventId_key" ON "GovernanceAuditEntry"("eventId");

-- CreateIndex
CREATE INDEX "GovernanceAuditEntry_module_idx" ON "GovernanceAuditEntry"("module");

-- CreateIndex
CREATE INDEX "GovernanceAuditEntry_status_idx" ON "GovernanceAuditEntry"("status");

-- CreateIndex
CREATE INDEX "GovernanceAuditEntry_timestamp_idx" ON "GovernanceAuditEntry"("timestamp");
