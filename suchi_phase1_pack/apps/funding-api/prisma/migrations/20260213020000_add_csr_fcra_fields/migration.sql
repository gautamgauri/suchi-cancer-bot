-- AlterTable
ALTER TABLE "PipelineEntry" ADD COLUMN     "foreignSourceHint" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "csr1Status" TEXT,
ADD COLUMN     "csr1Number" TEXT,
ADD COLUMN     "grantAgreementStatus" TEXT,
ADD COLUMN     "reportingCadence" TEXT,
ADD COLUMN     "ucDueDate" TIMESTAMP(3),
ADD COLUMN     "impactReportDueDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PipelineEntry_ucDueDate_idx" ON "PipelineEntry"("ucDueDate");

-- CreateIndex
CREATE INDEX "PipelineEntry_impactReportDueDate_idx" ON "PipelineEntry"("impactReportDueDate");
