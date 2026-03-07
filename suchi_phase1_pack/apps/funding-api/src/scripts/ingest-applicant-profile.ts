/**
 * One-off script: ingest applicant-profile.md into the evidence library
 * so the proposal orchestrator can retrieve founder/personal info for fellowship applications.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx ts-node src/scripts/ingest-applicant-profile.ts
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const PROFILE_PATH = path.resolve(
  __dirname,
  "../modules/application/data/applicant-profile.md",
);

async function main() {
  const prisma = new PrismaClient();

  const rawText = fs.readFileSync(PROFILE_PATH, "utf-8");
  const driveFileId = "manual::applicant-profile-gautam-gauri";

  // Check if already exists
  const existing = await prisma.evidenceDocument.findUnique({
    where: { driveFileId },
  });

  if (existing) {
    console.log(`Already exists: ${existing.id} — updating text`);
    await prisma.evidenceDocument.update({
      where: { id: existing.id },
      data: {
        rawText,
        cleanText: rawText,
        extractionStatus: "success",
      },
    });
    console.log("Updated.");
  } else {
    const doc = await prisma.evidenceDocument.create({
      data: {
        driveFileId,
        sourceFolder: "applicant_profiles",
        corpus: "personal",
        orgId: "gautam",
        qualityTier: "A",
        qualityScore: 95,
        name: "Applicant Profile — Gautam Gauri (Founder)",
        mimeType: "text/markdown",
        createdTime: new Date(),
        modifiedTime: new Date(),
        downloadStatus: "success",
        rawText,
        cleanText: rawText,
        extractionStatus: "success",
        extractionMeta: {
          source: "manual_ingest",
          description:
            "Founder profile with bios, AI story, Cambridge connection, Why Me, personal motivation — for fellowship/accelerator applications",
        },
      },
    });
    console.log(`Created EvidenceDocument: ${doc.id}`);
  }

  // Also ingest the org profile
  const orgProfilePath = path.resolve(
    __dirname,
    "../modules/proposal/prompts/org-profile.ts",
  );
  const orgRaw = fs.readFileSync(orgProfilePath, "utf-8");
  // Extract the template literal content
  const match = orgRaw.match(/export const DIKSHA_ORG_PROFILE = `([\s\S]*?)`/);
  if (match) {
    const orgText = match[1].trim();
    const orgDriveFileId = "manual::diksha-org-profile";
    const orgExisting = await prisma.evidenceDocument.findUnique({
      where: { driveFileId: orgDriveFileId },
    });

    if (orgExisting) {
      console.log(`Org profile already exists: ${orgExisting.id} — updating`);
      await prisma.evidenceDocument.update({
        where: { id: orgExisting.id },
        data: { rawText: orgText, cleanText: orgText, extractionStatus: "success" },
      });
    } else {
      const orgDoc = await prisma.evidenceDocument.create({
        data: {
          driveFileId: orgDriveFileId,
          sourceFolder: "applicant_profiles",
          corpus: "diksha_internal",
          qualityTier: "A",
          qualityScore: 95,
          name: "Diksha Foundation — Organisation Profile 2026-27",
          mimeType: "text/markdown",
          createdTime: new Date(),
          modifiedTime: new Date(),
          downloadStatus: "success",
          rawText: orgText,
          cleanText: orgText,
          extractionStatus: "success",
          extractionMeta: {
            source: "manual_ingest",
            description:
              "Full org profile — programs, team, board, metrics, certifications",
          },
        },
      });
      console.log(`Created org profile EvidenceDocument: ${orgDoc.id}`);
    }
  }

  await prisma.$disconnect();
  console.log("Done. Now run chunk + embed endpoints to make these searchable.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
