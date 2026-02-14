-- CreateTable ProgramActivity
CREATE TABLE "ProgramActivity" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "programArea" TEXT NOT NULL,
    "activityName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "centers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetGroup" TEXT,
    "frequency" TEXT,
    "assetsNeeded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unitCostINR" INTEGER,
    "costBreakdown" TEXT,
    "outcomes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "indicators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "staffInvolved" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orgId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProgramActivity_activityId_key" ON "ProgramActivity"("activityId");
CREATE INDEX "ProgramActivity_programArea_idx" ON "ProgramActivity"("programArea");
CREATE INDEX "ProgramActivity_orgId_idx" ON "ProgramActivity"("orgId");
CREATE INDEX "ProgramActivity_isActive_idx" ON "ProgramActivity"("isActive");
