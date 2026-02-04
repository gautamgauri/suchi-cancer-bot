-- CreateTable FrameworkCapability
CREATE TABLE "FrameworkCapability" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definitionShort" VARCHAR(240) NOT NULL,
    "definitionLong" TEXT NOT NULL,
    "subdimensions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "biharContextExamples" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "measurementIdeas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ethicsRisks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrameworkCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FrameworkCapability_capabilityId_key" ON "FrameworkCapability"("capabilityId");

-- CreateTable FrameworkMI
CREATE TABLE "FrameworkMI" (
    "id" TEXT NOT NULL,
    "miId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definitionShort" VARCHAR(240) NOT NULL,
    "activitySignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assessmentArtifacts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrameworkMI_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FrameworkMI_miId_key" ON "FrameworkMI"("miId");

-- CreateTable FrameworkMethodCard
CREATE TABLE "FrameworkMethodCard" (
    "id" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "whenToUse" TEXT,
    "whenNotToUse" TEXT,
    "ageBand" TEXT,
    "settingTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assessmentArtifacts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceDocId" TEXT,
    "sourceUrl" TEXT,
    "licenseFlag" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "qualityScore" INTEGER DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validatedAt" TIMESTAMP(3),
    "validatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrameworkMethodCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FrameworkMethodCard_methodId_key" ON "FrameworkMethodCard"("methodId");

-- CreateTable MethodCardMI
CREATE TABLE "MethodCardMI" (
    "id" TEXT NOT NULL,
    "methodCardId" TEXT NOT NULL,
    "miId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MethodCardMI_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MethodCardMI_methodCardId_miId_key" ON "MethodCardMI"("methodCardId", "miId");

-- CreateTable MethodCardCapability
CREATE TABLE "MethodCardCapability" (
    "id" TEXT NOT NULL,
    "methodCardId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,

    CONSTRAINT "MethodCardCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MethodCardCapability_methodCardId_capabilityId_key" ON "MethodCardCapability"("methodCardId", "capabilityId");

-- CreateTable MethodCardChunk
CREATE TABLE "MethodCardChunk" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,

    CONSTRAINT "MethodCardChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MethodCardChunk_cardId_idx" ON "MethodCardChunk"("cardId");

-- CreateTable MethodCardChunkEmbedding
CREATE TABLE "MethodCardChunkEmbedding" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "vector" TEXT NOT NULL,

    CONSTRAINT "MethodCardChunkEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MethodCardChunkEmbedding_chunkId_key" ON "MethodCardChunkEmbedding"("chunkId");

-- CreateTable FrameworkPatternCard
CREATE TABLE "FrameworkPatternCard" (
    "id" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMins" INTEGER,
    "materials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "facilitatorScript" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adaptations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assessmentArtifacts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceDocId" TEXT,
    "sourceUrl" TEXT,
    "evidenceLevel" TEXT NOT NULL DEFAULT 'ANECDOTAL',
    "qualityScore" INTEGER DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validatedAt" TIMESTAMP(3),
    "validatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrameworkPatternCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FrameworkPatternCard_patternId_key" ON "FrameworkPatternCard"("patternId");

-- CreateTable PatternCardMI
CREATE TABLE "PatternCardMI" (
    "id" TEXT NOT NULL,
    "patternCardId" TEXT NOT NULL,
    "miId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PatternCardMI_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatternCardMI_patternCardId_miId_key" ON "PatternCardMI"("patternCardId", "miId");

-- CreateTable PatternCardCapability
CREATE TABLE "PatternCardCapability" (
    "id" TEXT NOT NULL,
    "patternCardId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PatternCardCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatternCardCapability_patternCardId_capabilityId_key" ON "PatternCardCapability"("patternCardId", "capabilityId");

-- CreateTable PatternCardChunk
CREATE TABLE "PatternCardChunk" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,

    CONSTRAINT "PatternCardChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatternCardChunk_cardId_idx" ON "PatternCardChunk"("cardId");

-- CreateTable PatternCardChunkEmbedding
CREATE TABLE "PatternCardChunkEmbedding" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "vector" TEXT NOT NULL,

    CONSTRAINT "PatternCardChunkEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatternCardChunkEmbedding_chunkId_key" ON "PatternCardChunkEmbedding"("chunkId");

-- CreateTable FrameworkComparableCase
CREATE TABLE "FrameworkComparableCase" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "programName" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "geography" TEXT NOT NULL,
    "targetGroup" TEXT NOT NULL,
    "deliveryModelTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcomesSummary" TEXT NOT NULL,
    "indicatorsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "costNotes" TEXT,
    "programConstraints" TEXT,
    "contextConstraints" TEXT,
    "transferabilityBihar" TEXT,
    "sourceDocId" TEXT,
    "sourceUrl" TEXT,
    "confidenceScore" INTEGER NOT NULL DEFAULT 3,
    "qualityScore" INTEGER DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validatedAt" TIMESTAMP(3),
    "validatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrameworkComparableCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FrameworkComparableCase_caseId_key" ON "FrameworkComparableCase"("caseId");

-- CreateTable ComparableCaseCapability
CREATE TABLE "ComparableCaseCapability" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ComparableCaseCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComparableCaseCapability_caseId_capabilityId_key" ON "ComparableCaseCapability"("caseId", "capabilityId");

-- CreateTable ComparableCaseChunk
CREATE TABLE "ComparableCaseChunk" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,

    CONSTRAINT "ComparableCaseChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComparableCaseChunk_cardId_idx" ON "ComparableCaseChunk"("cardId");

-- CreateTable ComparableCaseChunkEmbedding
CREATE TABLE "ComparableCaseChunkEmbedding" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "vector" TEXT NOT NULL,

    CONSTRAINT "ComparableCaseChunkEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComparableCaseChunkEmbedding_chunkId_key" ON "ComparableCaseChunkEmbedding"("chunkId");

-- CreateTable ProjectCapability
CREATE TABLE "ProjectCapability" (
    "id" TEXT NOT NULL,
    "pipelineEntryId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "strength" INTEGER,
    "isApplicable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProjectCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectCapability_pipelineEntryId_capabilityId_key" ON "ProjectCapability"("pipelineEntryId", "capabilityId");
CREATE INDEX "ProjectCapability_pipelineEntryId_idx" ON "ProjectCapability"("pipelineEntryId");

-- CreateTable OpportunityCapability
CREATE TABLE "OpportunityCapability" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "strength" INTEGER,
    "isApplicable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OpportunityCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpportunityCapability_opportunityId_capabilityId_key" ON "OpportunityCapability"("opportunityId", "capabilityId");
CREATE INDEX "OpportunityCapability_opportunityId_idx" ON "OpportunityCapability"("opportunityId");

-- CreateTable DocumentCapability
CREATE TABLE "DocumentCapability" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "strength" INTEGER,

    CONSTRAINT "DocumentCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentCapability_documentId_capabilityId_key" ON "DocumentCapability"("documentId", "capabilityId");
CREATE INDEX "DocumentCapability_documentId_idx" ON "DocumentCapability"("documentId");

-- CreateTable DocumentMIModality
CREATE TABLE "DocumentMIModality" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "modalityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DocumentMIModality_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentMIModality_documentId_modalityId_key" ON "DocumentMIModality"("documentId", "modalityId");
CREATE INDEX "DocumentMIModality_documentId_idx" ON "DocumentMIModality"("documentId");

-- CreateTable FrameworkAnalyticsEvent
CREATE TABLE "FrameworkAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrameworkAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FrameworkAnalyticsEvent_eventType_idx" ON "FrameworkAnalyticsEvent"("eventType");
CREATE INDEX "FrameworkAnalyticsEvent_projectId_idx" ON "FrameworkAnalyticsEvent"("projectId");
CREATE INDEX "FrameworkAnalyticsEvent_createdAt_idx" ON "FrameworkAnalyticsEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "MethodCardMI" ADD CONSTRAINT "MethodCardMI_methodCardId_fkey" FOREIGN KEY ("methodCardId") REFERENCES "FrameworkMethodCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MethodCardMI" ADD CONSTRAINT "MethodCardMI_miId_fkey" FOREIGN KEY ("miId") REFERENCES "FrameworkMI"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MethodCardCapability" ADD CONSTRAINT "MethodCardCapability_methodCardId_fkey" FOREIGN KEY ("methodCardId") REFERENCES "FrameworkMethodCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MethodCardCapability" ADD CONSTRAINT "MethodCardCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "FrameworkCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MethodCardChunk" ADD CONSTRAINT "MethodCardChunk_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "FrameworkMethodCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MethodCardChunkEmbedding" ADD CONSTRAINT "MethodCardChunkEmbedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "MethodCardChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatternCardMI" ADD CONSTRAINT "PatternCardMI_patternCardId_fkey" FOREIGN KEY ("patternCardId") REFERENCES "FrameworkPatternCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatternCardMI" ADD CONSTRAINT "PatternCardMI_miId_fkey" FOREIGN KEY ("miId") REFERENCES "FrameworkMI"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatternCardCapability" ADD CONSTRAINT "PatternCardCapability_patternCardId_fkey" FOREIGN KEY ("patternCardId") REFERENCES "FrameworkPatternCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatternCardCapability" ADD CONSTRAINT "PatternCardCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "FrameworkCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatternCardChunk" ADD CONSTRAINT "PatternCardChunk_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "FrameworkPatternCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatternCardChunkEmbedding" ADD CONSTRAINT "PatternCardChunkEmbedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "PatternCardChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComparableCaseCapability" ADD CONSTRAINT "ComparableCaseCapability_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "FrameworkComparableCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComparableCaseCapability" ADD CONSTRAINT "ComparableCaseCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "FrameworkCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComparableCaseChunk" ADD CONSTRAINT "ComparableCaseChunk_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "FrameworkComparableCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComparableCaseChunkEmbedding" ADD CONSTRAINT "ComparableCaseChunkEmbedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ComparableCaseChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectCapability" ADD CONSTRAINT "ProjectCapability_pipelineEntryId_fkey" FOREIGN KEY ("pipelineEntryId") REFERENCES "PipelineEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectCapability" ADD CONSTRAINT "ProjectCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "FrameworkCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityCapability" ADD CONSTRAINT "OpportunityCapability_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityCapability" ADD CONSTRAINT "OpportunityCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "FrameworkCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentCapability" ADD CONSTRAINT "DocumentCapability_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EvidenceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentCapability" ADD CONSTRAINT "DocumentCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "FrameworkCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentMIModality" ADD CONSTRAINT "DocumentMIModality_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EvidenceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentMIModality" ADD CONSTRAINT "DocumentMIModality_modalityId_fkey" FOREIGN KEY ("modalityId") REFERENCES "FrameworkMI"("id") ON DELETE CASCADE ON UPDATE CASCADE;
