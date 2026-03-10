-- CreateTable
CREATE TABLE "SccfDocument" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "driveUrl" TEXT,
    "emailSubject" TEXT,
    "emailFrom" TEXT,
    "emailDate" TIMESTAMP(3),
    "modifiedTime" TIMESTAMP(3),
    "category" TEXT,
    "topicTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryNote" TEXT,
    "ingestStatus" TEXT NOT NULL DEFAULT 'pending',
    "kbDocId" TEXT,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SccfDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SccfDocument_externalId_key" ON "SccfDocument"("externalId");

-- CreateIndex
CREATE INDEX "SccfDocument_sourceType_idx" ON "SccfDocument"("sourceType");

-- CreateIndex
CREATE INDEX "SccfDocument_ingestStatus_idx" ON "SccfDocument"("ingestStatus");
