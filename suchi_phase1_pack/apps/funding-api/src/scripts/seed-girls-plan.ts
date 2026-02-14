/* eslint-disable no-console */
/**
 * Seed ProgramPlan + ProgramPlanMonth + ProgramPlanWeek
 * from "Month wise Adolescent_Girls_Plan.xlsx"
 *
 * Creates:
 *   1 ProgramPlan ("Empowering Futures Adolescent Girls Plan")
 *   12 ProgramPlanMonth records (themes from APF capabilities mapping)
 *   48 ProgramPlanWeek records (4 weeks × 12 months)
 *
 * Usage: npx ts-node src/scripts/seed-girls-plan.ts [path-to-xlsx] [path-to-apf-xlsx]
 */

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import * as path from "path";

const prisma = new PrismaClient();

// Monthly themes + capabilities from APF_Capabilities_Mapping.xlsx "Monthly Capability Focus" sheet
const MONTH_THEMES: Record<number, {
  theme: string;
  primary: string[];
  secondary: string[];
}> = {
  1: { theme: "Foundation & Mapping", primary: ["Control Over Environment", "Social Affiliation"], secondary: ["Practical Reason"] },
  2: { theme: "Self-Discovery", primary: ["Emotions", "Social Affiliation", "Play"], secondary: ["Practical Reason", "Bodily Integrity"] },
  3: { theme: "Gender & Power", primary: ["Practical Reason", "Bodily Integrity", "Social Affiliation"], secondary: ["Senses & Thought", "Emotions"] },
  4: { theme: "Trust & Safety", primary: ["Bodily Integrity", "Emotions", "Play"], secondary: ["Social Affiliation", "Practical Reason"] },
  5: { theme: "Body & Health", primary: ["Bodily Health", "Bodily Integrity"], secondary: ["Practical Reason", "Senses & Thought"] },
  6: { theme: "Decision Making & Choices", primary: ["Practical Reason", "Control Over Environment"], secondary: ["Emotions", "Social Affiliation"] },
  7: { theme: "Career & Livelihood", primary: ["Practical Reason", "Control Over Environment"], secondary: ["Senses & Thought", "Social Affiliation"] },
  8: { theme: "Digital Literacy", primary: ["Senses & Thought", "Practical Reason"], secondary: ["Control Over Environment", "Play"] },
  9: { theme: "Rights & Agency", primary: ["Practical Reason", "Social Affiliation", "Bodily Integrity"], secondary: ["Control Over Environment"] },
  10: { theme: "Civic Participation", primary: ["Control Over Environment", "Social Affiliation", "Practical Reason"], secondary: ["Senses & Thought"] },
  11: { theme: "Theater & Arts", primary: ["Senses & Thought", "Social Affiliation", "Play"], secondary: ["Emotions", "Bodily Integrity"] },
  12: { theme: "Reflection, Feedback & Graduation", primary: ["Practical Reason", "Emotions", "Social Affiliation"], secondary: ["Control Over Environment"] },
};

function cleanText(val: unknown): string {
  if (val == null) return "";
  return String(val).replace(/\r\n/g, "\n").trim();
}

async function main() {
  const planXlsxPath = process.argv[2] ||
    path.resolve("/mnt/c/Users/gauta/Downloads/Month wise Adolescent_Girls_Plan.xlsx");

  console.log("Reading plan:", planXlsxPath);
  const wb = XLSX.readFile(planXlsxPath);

  // 1. Create or find the ProgramPlan
  const existingPlan = await prisma.programPlan.findFirst({
    where: { planName: "Empowering Futures Adolescent Girls Plan" },
  });

  const plan = existingPlan || await prisma.programPlan.create({
    data: {
      planName: "Empowering Futures Adolescent Girls Plan",
      programArea: "adolescent_girls",
      totalMonths: 12,
      totalParticipants: "180 girls across 6 slums/villages",
      locations: ["Patna", "Bihta", "Sarairanjan"],
      orgId: "diksha",
      isActive: true,
    },
  });

  console.log(`Plan: ${plan.id} (${existingPlan ? "existing" : "created"})`);

  // 2. Process each month sheet
  let totalWeeks = 0;

  for (let monthNum = 1; monthNum <= 12; monthNum++) {
    const sheetName = `Month ${monthNum}`;
    const ws = wb.Sheets[sheetName];
    if (!ws) {
      console.warn(`Sheet "${sheetName}" not found, skipping`);
      continue;
    }

    const themeInfo = MONTH_THEMES[monthNum];

    // Use array mode to handle sheets with merged title rows (e.g., Month 2 has "SELF" merged header)
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });

    // Find the header row (contains "Week" in first cell)
    let headerIdx = rawRows.findIndex(r => /^week$/i.test(cleanText(r[0])));
    if (headerIdx === -1) {
      // Some sheets have header without "Week" label — try finding rows that start with "Week-1" or "Week 1"
      headerIdx = rawRows.findIndex(r => /week.?1/i.test(cleanText(r[0])));
      if (headerIdx >= 0) headerIdx--; // Back up to header row before the data
    }

    // Build rows as objects using discovered header
    const headers = headerIdx >= 0 ? rawRows[headerIdx].map((h: unknown) => cleanText(h)) : [];
    const dataRows = headerIdx >= 0 ? rawRows.slice(headerIdx + 1) : [];
    const data = dataRows.map(row => {
      const obj: Record<string, unknown> = {};
      (row as unknown[]).forEach((val, i) => {
        const key = headers[i] || `col${i}`;
        obj[key] = val;
      });
      return obj;
    });

    // Filter to rows that have a Week value
    const weekRows = data.filter(row => {
      // Check first column (Week) and any key containing "week"
      const weekVal = cleanText(row["Week"] || row["week"] || row[headers[0]] || Object.values(row)[0]);
      return /week/i.test(weekVal);
    });

    // Create or update ProgramPlanMonth
    const existingMonth = await prisma.programPlanMonth.findUnique({
      where: { planId_monthNumber: { planId: plan.id, monthNumber: monthNum } },
    });

    const month = existingMonth || await prisma.programPlanMonth.create({
      data: {
        planId: plan.id,
        monthNumber: monthNum,
        theme: themeInfo.theme,
        primaryCapabilities: themeInfo.primary,
        secondaryCapabilities: themeInfo.secondary,
      },
    });

    if (existingMonth) {
      await prisma.programPlanMonth.update({
        where: { id: month.id },
        data: {
          theme: themeInfo.theme,
          primaryCapabilities: themeInfo.primary,
          secondaryCapabilities: themeInfo.secondary,
        },
      });
    }

    console.log(`  Month ${monthNum}: "${themeInfo.theme}" — ${weekRows.length} weeks`);

    // 3. Process each week
    for (let i = 0; i < weekRows.length; i++) {
      const row = weekRows[i];
      const weekNumber = i + 1;

      // Flexible column access: try named keys first, then positional (col0-col6)
      const col = (idx: number, ...names: string[]) => {
        for (const n of names) {
          const v = row[n];
          if (v != null && cleanText(v)) return cleanText(v);
        }
        // Fallback: positional key from array-mode headers
        const positionalKey = headers[idx] || `col${idx}`;
        return cleanText(row[positionalKey]) || "";
      };

      const focusArea = col(1, "Focus", "Focus ", "Focus Area") || `Week ${weekNumber}`;
      const mainActivities = col(2, "Main Activities", "Main Activity ", "Main Activity") || "Not specified";
      const smartActivities = col(3, "SMART Activities", "SMART Activity ", "SMART Activity") || "Not specified";
      const deliverables = col(4, "Deliverables", "Deliverabale ", "Deliverable") || "Not specified";
      const monitoring = col(5, "Monitoring & Evaluation", "M&E", "Monitoring") || null;
      const team = col(6, "Team", "Team Structure ", "Team Structure") || null;

      await prisma.programPlanWeek.upsert({
        where: {
          monthId_weekNumber: { monthId: month.id, weekNumber },
        },
        create: {
          monthId: month.id,
          weekNumber,
          focusArea,
          mainActivities,
          smartActivities,
          deliverables,
          monitoringNotes: monitoring,
          teamNotes: team,
        },
        update: {
          focusArea,
          mainActivities,
          smartActivities,
          deliverables,
          monitoringNotes: monitoring,
          teamNotes: team,
        },
      });
      totalWeeks++;
    }
  }

  console.log(`\nSeeded: 1 plan, 12 months, ${totalWeeks} weeks`);
  console.log("Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
