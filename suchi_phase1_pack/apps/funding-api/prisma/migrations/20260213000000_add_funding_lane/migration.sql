-- AlterTable
ALTER TABLE "PipelineEntry" ADD COLUMN     "fundingLane" TEXT,
ADD COLUMN     "complianceRiskFlag" TEXT,
ADD COLUMN     "bankRouteHint" TEXT;

-- CreateIndex
CREATE INDEX "PipelineEntry_fundingLane_idx" ON "PipelineEntry"("fundingLane");
