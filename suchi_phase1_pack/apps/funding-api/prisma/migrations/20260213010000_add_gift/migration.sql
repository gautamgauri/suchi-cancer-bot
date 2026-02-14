-- CreateTable
CREATE TABLE "Gift" (
    "id" TEXT NOT NULL,
    "donorName" TEXT NOT NULL,
    "donorType" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "dateReceived" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL,
    "txnRef" TEXT,
    "mappedBankCredit" BOOLEAN NOT NULL DEFAULT false,
    "fundingLane" TEXT NOT NULL,
    "purposeRestriction" TEXT,
    "fy" TEXT NOT NULL,
    "complianceStatus" TEXT,
    "pan" TEXT,
    "contactEmail" TEXT,
    "contactMobile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Gift_dateReceived_idx" ON "Gift"("dateReceived");

-- CreateIndex
CREATE INDEX "Gift_fy_idx" ON "Gift"("fy");

-- CreateIndex
CREATE INDEX "Gift_fundingLane_idx" ON "Gift"("fundingLane");

-- CreateIndex
CREATE INDEX "Gift_mappedBankCredit_idx" ON "Gift"("mappedBankCredit");
