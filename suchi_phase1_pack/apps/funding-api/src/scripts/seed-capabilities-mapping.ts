/* eslint-disable no-console */
/**
 * Seed ProgramActivityCapability junction from APF_Capabilities_Mapping.xlsx
 *
 * Links ProgramActivity records to FrameworkCapability (C1-C10) with strength ratings.
 * Also populates CapabilityIndicator from the Football Deep Dive and Coverage sheets.
 *
 * Prerequisites:
 *   - ProgramActivity records must exist (seed-program-activities or manual insert)
 *   - FrameworkCapability C1-C10 must exist (seed-framework-taxonomy)
 *
 * Usage: npx ts-node src/scripts/seed-capabilities-mapping.ts [path-to-xlsx]
 */

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import * as path from "path";

const prisma = new PrismaClient();

// Map Excel column headers → FrameworkCapability.capabilityId
// DB names: C1=Life, C2=Bodily Health, C3=Bodily Integrity, C4=Senses/Imagination/Thought,
//           C5=Emotions, C6=Practical Reason, C7=Affiliation, C8=Other Species,
//           C9=Play, C10=Control over Environment
const COLUMN_TO_CAPABILITY: Record<string, string> = {
  "Practical Reason\n(Critical Thinking)": "C6",  // Practical Reason
  "Bodily Integrity": "C3",
  "Social Affiliation": "C7",                     // Affiliation
  "Senses, Imagination\n& Thought": "C4",         // Senses, Imagination, Thought
  "Control Over\nEnvironment": "C10",              // Control over Environment
  "Life": "C1",
  "Bodily Health": "C2",
  "Emotions": "C5",
  "Play": "C9",
  "Other Species": "C8",
};

// Map programme components → ProgramActivity.activityId (best-effort matching)
const COMPONENT_TO_ACTIVITY: Record<string, string> = {
  "Football & Sports": "sports_football",
  "Life Skills Education": "life_skills_sel",
  "Gender & Identity": "life_skills_gender",
  "Health & WASH": "life_skills_health_wash",
  "Digital Literacy": "digital_literacy",
  "Career & Livelihood": "life_skills_career",
  "Theater & Arts": "civic_theater_arts",
  "Community Engagement": "civic_community",
  "Peer Learning": "education_peer_learning",
  "Government Scheme Linkage": "civic_govt_scheme",
  "Meals & Nutrition": "nutrition_meals",
  "Alumni Network": "civic_alumni",
  "Parents & Family": "civic_parents",
  "M&E & Documentation": "operations_mne",
  "Civic Participation": "civic_participation",
  "Leadership & Agency": "life_skills_leadership",
};

async function main() {
  const xlsxPath = process.argv[2] ||
    path.resolve("/mnt/c/Users/gauta/Downloads/APF_Capabilities_Mapping.xlsx");

  console.log("Reading:", xlsxPath);
  const wb = XLSX.readFile(xlsxPath);

  // 1. Fetch existing capabilities and activities
  const capabilities = await prisma.frameworkCapability.findMany();
  const capMap = new Map(capabilities.map(c => [c.capabilityId, c.id]));
  console.log(`Found ${capabilities.length} capabilities in DB`);

  const activities = await prisma.programActivity.findMany();
  const actMap = new Map(activities.map(a => [a.activityId, a.id]));
  console.log(`Found ${activities.length} program activities in DB`);

  // 2. Parse "Capabilities Mapping" sheet → ProgramActivityCapability
  const mappingSheet = wb.Sheets["Capabilities Mapping"];
  const mappingData = XLSX.utils.sheet_to_json<Record<string, unknown>>(mappingSheet);

  let created = 0;
  let skipped = 0;

  for (const row of mappingData) {
    const component = String(row["Programme Component"] || "").trim();
    const activityId = COMPONENT_TO_ACTIVITY[component];
    if (!activityId) {
      console.warn(`  No activity mapping for component: "${component}"`);
      skipped++;
      continue;
    }

    const actDbId = actMap.get(activityId);
    if (!actDbId) {
      console.warn(`  ProgramActivity "${activityId}" not found in DB — will create it`);
      // Auto-create a minimal ProgramActivity
      const description = String(row["Description"] || "");
      const monthsActive = String(row["Months Active"] || "");
      const newAct = await prisma.programActivity.create({
        data: {
          activityId,
          programArea: activityId.split("_")[0],
          activityName: component,
          description: description || component,
          frequency: monthsActive ? `Months ${monthsActive}` : undefined,
          orgId: "diksha",
        },
      });
      actMap.set(activityId, newAct.id);
      console.log(`  Created ProgramActivity: ${activityId} → ${newAct.id}`);
    }

    const primaryCaps = String(row["Primary Capabilities"] || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    // Process each capability column
    for (const [colName, capId] of Object.entries(COLUMN_TO_CAPABILITY)) {
      const strength = Number(row[colName]);
      if (!strength || strength < 1) continue;

      const capDbId = capMap.get(capId);
      if (!capDbId) {
        console.warn(`  Capability ${capId} not found in DB`);
        continue;
      }

      const capName = capabilities.find(c => c.capabilityId === capId)?.name || capId;
      const isPrimary = primaryCaps.some(p =>
        capName.toLowerCase().includes(p.toLowerCase()) ||
        p.toLowerCase().includes(capName.toLowerCase())
      );

      await prisma.programActivityCapability.upsert({
        where: {
          programActivityId_capabilityId: {
            programActivityId: actMap.get(activityId)!,
            capabilityId: capDbId,
          },
        },
        create: {
          programActivityId: actMap.get(activityId)!,
          capabilityId: capDbId,
          strength: Math.min(strength, 3),
          isPrimary,
        },
        update: {
          strength: Math.min(strength, 3),
          isPrimary,
        },
      });
      created++;
    }
  }

  console.log(`\nProgramActivityCapability: ${created} upserted, ${skipped} skipped`);

  // 3. Parse "Football Deep Dive" → CapabilityIndicator
  const footballSheet = wb.Sheets["Football Deep Dive"];
  const footballData = XLSX.utils.sheet_to_json<Record<string, unknown>>(footballSheet, {
    range: 1, // skip merged title row
  });

  let indicators = 0;
  for (const row of footballData) {
    const capName = String(row["Capability"] || "").trim();
    if (!capName) continue;

    // Find the capability by name (fuzzy: substring match in either direction, strip punctuation)
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
    const capNorm = normalize(capName);
    const cap = capabilities.find(c => {
      const dbNorm = normalize(c.name);
      return dbNorm === capNorm || dbNorm.includes(capNorm) || capNorm.includes(dbNorm);
    });
    if (!cap) {
      console.warn(`  Football Deep Dive: capability "${capName}" not found`);
      continue;
    }

    const observableStr = String(row["Observable Indicators"] || "");
    const observableSignals = observableStr
      .split(";")
      .map(s => s.trim())
      .filter(Boolean);

    const activitiesStr = String(row["Specific Activities"] || "");
    const assessmentTools = activitiesStr
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    const months = String(row["Months"] || "");

    await prisma.capabilityIndicator.create({
      data: {
        capabilityId: cap.id,
        indicatorName: `Football: ${capName}`,
        observableSignals,
        assessmentTools,
        monthsActive: months || null,
      },
    });
    indicators++;
  }

  console.log(`CapabilityIndicator (Football Deep Dive): ${indicators} created`);

  // 4. Parse "Capability Coverage" → CapabilityIndicator (programme-level)
  const coverageSheet = wb.Sheets["Capability Coverage"];
  const coverageData = XLSX.utils.sheet_to_json<Record<string, unknown>>(coverageSheet);

  let coverageIndicators = 0;
  for (const row of coverageData) {
    const capName = String(row["Capability"] || "").trim();
    if (!capName) continue;

    const normCov = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
    const capNormCov = normCov(capName);
    const cap = capabilities.find(c => {
      const dbN = normCov(c.name);
      return dbN === capNormCov || dbN.includes(capNormCov) || capNormCov.includes(dbN);
    });
    if (!cap) continue;

    const components = String(row["Primary Programme Components"] || "");
    const months = String(row["Months Active"] || "");
    const coverage = String(row["Coverage"] || "");

    await prisma.capabilityIndicator.create({
      data: {
        capabilityId: cap.id,
        indicatorName: `Programme Coverage: ${capName}`,
        observableSignals: [coverage, `Components: ${components}`],
        assessmentTools: [],
        monthsActive: months || null,
      },
    });
    coverageIndicators++;
  }

  console.log(`CapabilityIndicator (Coverage): ${coverageIndicators} created`);
  console.log("\nDone!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
