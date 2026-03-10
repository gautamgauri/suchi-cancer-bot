-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "targetDomain" TEXT NOT NULL DEFAULT 'retrieval',
    "status" TEXT NOT NULL DEFAULT 'active',
    "baselineConfig" JSONB NOT NULL,
    "benchmarkSetVersion" TEXT NOT NULL DEFAULT 'gold-retrieval-v1',
    "codeSha" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'cli',
    "conclusion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "concludedAt" TIMESTAMP(3),

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentVariant" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "variantLabel" TEXT NOT NULL,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "configDelta" JSONB NOT NULL,
    "resolvedConfig" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "mutationSource" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "promotionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkRun" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "benchmarkSetId" TEXT NOT NULL,
    "benchmarkSetVersion" TEXT NOT NULL DEFAULT 'v1',
    "queryCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "codeSha" TEXT,
    "apiVersion" TEXT,
    "corpusSnapshotAt" TIMESTAMP(3),
    "sliceMetrics" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "BenchmarkRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "benchmarkRunId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "perQueryValues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Experiment_status_idx" ON "Experiment"("status");

-- CreateIndex
CREATE INDEX "Experiment_targetDomain_idx" ON "Experiment"("targetDomain");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentVariant_experimentId_variantLabel_key" ON "ExperimentVariant"("experimentId", "variantLabel");

-- CreateIndex
CREATE INDEX "ExperimentVariant_experimentId_idx" ON "ExperimentVariant"("experimentId");

-- CreateIndex
CREATE INDEX "ExperimentVariant_status_idx" ON "ExperimentVariant"("status");

-- CreateIndex
CREATE INDEX "ExperimentVariant_configHash_idx" ON "ExperimentVariant"("configHash");

-- CreateIndex
CREATE INDEX "BenchmarkRun_variantId_idx" ON "BenchmarkRun"("variantId");

-- CreateIndex
CREATE INDEX "BenchmarkRun_benchmarkSetId_idx" ON "BenchmarkRun"("benchmarkSetId");

-- CreateIndex
CREATE INDEX "MetricSnapshot_benchmarkRunId_idx" ON "MetricSnapshot"("benchmarkRunId");

-- CreateIndex
CREATE INDEX "MetricSnapshot_metricName_idx" ON "MetricSnapshot"("metricName");

-- AddForeignKey
ALTER TABLE "ExperimentVariant" ADD CONSTRAINT "ExperimentVariant_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ExperimentVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_benchmarkRunId_fkey" FOREIGN KEY ("benchmarkRunId") REFERENCES "BenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
