-- CreateTable
CREATE TABLE "EvidenceDocument" (
    "id" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "sourceFolder" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "modifiedTime" TIMESTAMP(3) NOT NULL,
    "parents" JSONB,
    "driveUrl" TEXT,
    "owners" TEXT,
    "versionKey" TEXT,
    "checksum" TEXT,
    "needsProcessing" BOOLEAN NOT NULL DEFAULT true,
    "rawStorageUri" TEXT,
    "downloadStatus" TEXT,
    "downloadError" TEXT,
    "downloadedAt" TIMESTAMP(3),
    "rawText" TEXT,
    "cleanText" TEXT,
    "extractionMeta" JSONB,
    "extractionStatus" TEXT,
    "needsOcr" BOOLEAN NOT NULL DEFAULT false,
    "canonicalDocId" TEXT,
    "docType" TEXT,
    "qualityScore" INTEGER,
    "qualityTier" TEXT,
    "flags" JSONB,
    "piiDetected" BOOLEAN NOT NULL DEFAULT false,
    "sensitivityLevel" TEXT,
    "cleanTextRedacted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewQueueEntry" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL,
    "tierOverride" TEXT,
    "docTypeOverride" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewQueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "sectionTitle" TEXT,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChunkEmbedding" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChunkEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceDocument_driveFileId_key" ON "EvidenceDocument"("driveFileId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewQueueEntry_documentId_key" ON "ReviewQueueEntry"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChunkEmbedding_chunkId_key" ON "ChunkEmbedding"("chunkId");

-- AddForeignKey
ALTER TABLE "ReviewQueueEntry" ADD CONSTRAINT "ReviewQueueEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EvidenceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EvidenceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkEmbedding" ADD CONSTRAINT "ChunkEmbedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
