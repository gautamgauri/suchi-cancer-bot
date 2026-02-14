-- Activity Instances (fortnightly report data)
CREATE TABLE "ActivityInstance" (
    "id" TEXT NOT NULL,
    "programActivityId" TEXT,
    "reportId" TEXT NOT NULL,
    "center" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "reportingPeriod" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "reporter" TEXT,
    "academicsNotes" TEXT,
    "lifiPhase" TEXT,
    "kaActiveStudents" INTEGER,
    "kaHours" DOUBLE PRECISION,
    "samagraParticipants" INTEGER,
    "selSessions" INTEGER,
    "selHours" DOUBLE PRECISION,
    "selTopic" TEXT,
    "steamProjectsCount" INTEGER,
    "steamDescription" TEXT,
    "baalSansadActivity" TEXT,
    "openHouseNotes" TEXT,
    "eventsDescription" TEXT,
    "eventParticipants" INTEGER,
    "communityVisits" INTEGER,
    "householdsReached" INTEGER,
    "childrenReached" INTEGER,
    "ptmParentsAttended" INTEGER,
    "mealsServed" INTEGER,
    "avgDailyMeals" INTEGER,
    "sportsActivities" TEXT,
    "alumniUpdates" TEXT,
    "attendancePercent" DOUBLE PRECISION,
    "enrollmentTotal" INTEGER,
    "challenges" TEXT,
    "notes" TEXT,
    "orgId" TEXT,
    "gmailMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityInstance_pkey" PRIMARY KEY ("id")
);

-- ProgramActivity <-> Capability junction
CREATE TABLE "ProgramActivityCapability" (
    "id" TEXT NOT NULL,
    "programActivityId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "strength" INTEGER NOT NULL DEFAULT 1,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProgramActivityCapability_pkey" PRIMARY KEY ("id")
);

-- Capability Indicators
CREATE TABLE "CapabilityIndicator" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "indicatorName" TEXT NOT NULL,
    "observableSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assessmentTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "monthsActive" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityIndicator_pkey" PRIMARY KEY ("id")
);

-- Program Plans
CREATE TABLE "ProgramPlan" (
    "id" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "programArea" TEXT NOT NULL,
    "totalMonths" INTEGER NOT NULL DEFAULT 12,
    "totalParticipants" TEXT,
    "locations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orgId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramPlan_pkey" PRIMARY KEY ("id")
);

-- Program Plan Months
CREATE TABLE "ProgramPlanMonth" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "monthNumber" INTEGER NOT NULL,
    "theme" TEXT NOT NULL,
    "primaryCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secondaryCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramPlanMonth_pkey" PRIMARY KEY ("id")
);

-- Program Plan Weeks
CREATE TABLE "ProgramPlanWeek" (
    "id" TEXT NOT NULL,
    "monthId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "focusArea" TEXT NOT NULL,
    "mainActivities" TEXT NOT NULL,
    "smartActivities" TEXT NOT NULL,
    "deliverables" TEXT NOT NULL,
    "monitoringNotes" TEXT,
    "teamNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramPlanWeek_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "ActivityInstance_reportId_key" ON "ActivityInstance"("reportId");
CREATE INDEX "ActivityInstance_center_idx" ON "ActivityInstance"("center");
CREATE INDEX "ActivityInstance_program_idx" ON "ActivityInstance"("program");
CREATE INDEX "ActivityInstance_reportDate_idx" ON "ActivityInstance"("reportDate");
CREATE INDEX "ActivityInstance_orgId_idx" ON "ActivityInstance"("orgId");

CREATE UNIQUE INDEX "ProgramActivityCapability_programActivityId_capabilityId_key" ON "ProgramActivityCapability"("programActivityId", "capabilityId");

CREATE INDEX "CapabilityIndicator_capabilityId_idx" ON "CapabilityIndicator"("capabilityId");

CREATE INDEX "ProgramPlan_orgId_idx" ON "ProgramPlan"("orgId");
CREATE INDEX "ProgramPlan_programArea_idx" ON "ProgramPlan"("programArea");

CREATE UNIQUE INDEX "ProgramPlanMonth_planId_monthNumber_key" ON "ProgramPlanMonth"("planId", "monthNumber");
CREATE INDEX "ProgramPlanMonth_planId_idx" ON "ProgramPlanMonth"("planId");

CREATE UNIQUE INDEX "ProgramPlanWeek_monthId_weekNumber_key" ON "ProgramPlanWeek"("monthId", "weekNumber");
CREATE INDEX "ProgramPlanWeek_monthId_idx" ON "ProgramPlanWeek"("monthId");

-- Foreign Keys
ALTER TABLE "ActivityInstance" ADD CONSTRAINT "ActivityInstance_programActivityId_fkey" FOREIGN KEY ("programActivityId") REFERENCES "ProgramActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProgramActivityCapability" ADD CONSTRAINT "ProgramActivityCapability_programActivityId_fkey" FOREIGN KEY ("programActivityId") REFERENCES "ProgramActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgramActivityCapability" ADD CONSTRAINT "ProgramActivityCapability_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "FrameworkCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CapabilityIndicator" ADD CONSTRAINT "CapabilityIndicator_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "FrameworkCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgramPlanMonth" ADD CONSTRAINT "ProgramPlanMonth_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProgramPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgramPlanWeek" ADD CONSTRAINT "ProgramPlanWeek_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "ProgramPlanMonth"("id") ON DELETE CASCADE ON UPDATE CASCADE;
