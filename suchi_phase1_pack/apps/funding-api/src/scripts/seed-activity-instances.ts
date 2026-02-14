/* eslint-disable no-console */
/**
 * Backfill ActivityInstance records from activity_registry_1yr_data.xlsx
 *
 * Imports fortnightly reports (27 rows) from the "Fortnightly Reports" sheet,
 * parsing numeric metrics from mixed-format cells (e.g. "29/74", "25 hrs", "₹6L").
 *
 * Usage: npx ts-node src/scripts/seed-activity-instances.ts [path-to-xlsx]
 */

import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import * as path from "path";

const prisma = new PrismaClient();

/** Extract first integer from a string like "29/74" → 29, "132/155 (61.3% attendance)" → 132 */
function extractInt(val: unknown): number | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") return Math.round(val);
  const str = String(val).replace(/,/g, "");
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Extract float from strings like "25 hrs" → 25, "61.3%" → 61.3 */
function extractFloat(val: unknown): number | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") return val;
  const str = String(val).replace(/,/g, "");
  const match = str.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
}

function cleanStr(val: unknown): string | null {
  if (val == null || val === "") return null;
  return String(val).replace(/\r\n/g, "\n").trim() || null;
}

function parseDate(val: unknown): Date {
  if (val instanceof Date) return val;
  if (typeof val === "number") {
    // Excel serial date
    return new Date((val - 25569) * 86400 * 1000);
  }
  const str = String(val);
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  // Fallback: try DD-MM-YYYY
  const parts = str.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (parts) return new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]));
  return new Date();
}

async function main() {
  const xlsxPath = process.argv[2] ||
    path.resolve("/mnt/c/Users/gauta/Downloads/activity_registry_1yr_data.xlsx");

  console.log("Reading:", xlsxPath);
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets["Fortnightly Reports"];
  if (!ws) {
    console.error("Sheet 'Fortnightly Reports' not found");
    process.exit(1);
  }

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  console.log(`Found ${data.length} fortnightly reports`);

  let created = 0;
  let updated = 0;

  for (const row of data) {
    const reportId = String(row["Report ID"] || "").trim();
    if (!reportId) continue;

    const center = String(row["Center"] || "").trim();
    const program = String(row["Program"] || "").trim();
    const reportingPeriod = String(row["Reporting Period"] || "").trim();
    const reportDate = parseDate(row["Report Date"]);

    const instanceData = {
      center,
      program,
      reportingPeriod,
      reportDate,
      reporter: cleanStr(row["Reporter"]),
      academicsNotes: cleanStr(row["Academics Notes"]),
      lifiPhase: cleanStr(row["LIFI Phase"]),
      kaActiveStudents: extractInt(row["KA Active Students"]),
      kaHours: extractFloat(row["KA Hours"]),
      samagraParticipants: extractInt(row["Samagra Participants"]),
      selSessions: extractInt(row["SEL Sessions"]),
      selHours: extractFloat(row["SEL Hours"]),
      selTopic: cleanStr(row["SEL Topic"]),
      steamProjectsCount: extractInt(row["STEAM Projects Count"]),
      steamDescription: cleanStr(row["STEAM Description"]),
      baalSansadActivity: cleanStr(row["Baal Sansad Activity"]),
      openHouseNotes: cleanStr(row["Open House Notes"]),
      eventsDescription: cleanStr(row["Events & Celebrations"]),
      eventParticipants: extractInt(row["Event Participants"]),
      mealsServed: extractInt(row["Meals Served (fortnight)"]),
      avgDailyMeals: extractInt(row["Avg Daily Meals"]),
      communityVisits: extractInt(row["Community Visits"]),
      householdsReached: extractInt(row["Households Reached"]),
      childrenReached: extractInt(row["Children Reached"]),
      ptmParentsAttended: extractInt(row["PTM (Parents Attended)"]),
      sportsActivities: cleanStr(row["Sports Activities"]),
      alumniUpdates: cleanStr(row["Alumni Updates"]),
      attendancePercent: extractFloat(row["Attendance %"]),
      enrollmentTotal: extractInt(row["Enrollment (total)"]),
      challenges: cleanStr(row["Challenges & Funding Gaps"]),
      notes: cleanStr(row["Notes"]) || cleanStr(row["Sitaram Ashram Notes"]),
      orgId: "diksha",
      gmailMessageId: cleanStr(row["Gmail Message ID"]),
    };

    const existing = await prisma.activityInstance.findUnique({
      where: { reportId },
    });

    if (existing) {
      await prisma.activityInstance.update({
        where: { reportId },
        data: instanceData,
      });
      updated++;
    } else {
      await prisma.activityInstance.create({
        data: {
          reportId,
          ...instanceData,
        },
      });
      created++;
    }

    console.log(`  ${existing ? "Updated" : "Created"}: ${reportId} (${center}, ${reportingPeriod})`);
  }

  console.log(`\nActivityInstance: ${created} created, ${updated} updated`);

  // Summary stats
  const stats = await prisma.activityInstance.aggregate({
    _count: { id: true },
    _sum: { mealsServed: true, enrollmentTotal: true },
    _avg: { attendancePercent: true },
  });
  console.log("\nDB Stats:");
  console.log(`  Total instances: ${stats._count.id}`);
  console.log(`  Total meals: ${stats._sum.mealsServed}`);
  console.log(`  Avg enrollment: ${stats._sum.enrollmentTotal}`);
  console.log(`  Avg attendance: ${stats._avg.attendancePercent?.toFixed(1)}%`);

  console.log("\nDone!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
