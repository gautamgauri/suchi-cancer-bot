-- CreateTable
CREATE TABLE "PipelineEntry" (
    "id" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "stage" TEXT NOT NULL,
    "owner" TEXT,
    "nextAction" TEXT,
    "nextActionDate" TIMESTAMP(3),
    "lastContactDate" TIMESTAMP(3),
    "probability" INTEGER,
    "notes" TEXT,
    "sectorTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "geography" TEXT,
    "estimatedGrantSize" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PipelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "pipelineEntryId" TEXT,
    "donorId" TEXT,
    "orgId" TEXT,
    "type" TEXT NOT NULL,
    "notes" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_pipelineEntryId_fkey" FOREIGN KEY ("pipelineEntryId") REFERENCES "PipelineEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
