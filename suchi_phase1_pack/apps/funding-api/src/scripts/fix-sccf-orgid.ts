/**
 * One-time fix: set orgId="sccf" and corpus="sccf_internal" on all
 * EvidenceDocuments created by the SCCF ingest pipeline.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx ts-node src/scripts/fix-sccf-orgid.ts
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();

  try {
    // Fix EvidenceDocuments from SCCF ingest (identifiable by sourceFolder or driveFileId prefix)
    const docResult = await prisma.evidenceDocument.updateMany({
      where: {
        OR: [
          { sourceFolder: "sccf_ingest" },
          { driveFileId: { startsWith: "sccf::" } },
        ],
        orgId: null,
      },
      data: {
        orgId: "sccf",
        corpus: "sccf_internal",
      },
    });
    console.log(`Updated ${docResult.count} EvidenceDocuments → orgId="sccf", corpus="sccf_internal"`);

    // Summary
    const total = await prisma.evidenceDocument.count({ where: { orgId: "sccf" } });
    const chunks = await prisma.documentChunk.count({
      where: { document: { orgId: "sccf" } },
    });
    console.log(`\nSCCF totals: ${total} documents, ${chunks} chunks`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
