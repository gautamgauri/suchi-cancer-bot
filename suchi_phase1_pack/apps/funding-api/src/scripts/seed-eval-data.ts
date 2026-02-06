/**
 * Seed script for funding-eval CI tests
 * Creates deterministic test data for evidence retrieval and framework tests
 *
 * Usage: npx tsx src/scripts/seed-eval-data.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Deterministic IDs for test data (allows upsert idempotency)
const EVAL_DOC_ID = "eval-doc-001";
const EVAL_CHUNK_IDS = ["eval-chunk-001", "eval-chunk-002", "eval-chunk-003"];
const EVAL_CAPABILITY_IDS = ["C1", "C2", "C3"];

// Sample evidence documents for retrieval tests
const EVAL_DOCUMENTS = [
  {
    driveFileId: EVAL_DOC_ID,
    sourceFolder: "eval-test",
    name: "Teacher Training Impact Study",
    mimeType: "application/pdf",
    createdTime: new Date("2024-01-01"),
    modifiedTime: new Date("2024-06-01"),
    qualityTier: "A",
    qualityScore: 85,
    publicSafe: true,
    visibilityScope: "internal",
    cleanText: `Teacher training programs in rural Bihar have shown significant impact on student learning outcomes.
A 2-year longitudinal study across 150 schools demonstrated:
- 23% improvement in literacy rates among Grade 3 students
- 18% improvement in numeracy skills
- Teacher retention increased by 35% when continuous professional development was provided

Key success factors included:
1. Hands-on practice sessions rather than lecture-based training
2. Peer mentoring networks among teachers
3. Regular follow-up observations and feedback
4. Integration of local context and vernacular materials

The KHEL project specifically focused on life skills education, incorporating social-emotional learning
alongside academic content. Results showed improved student engagement and reduced dropout rates.`,
  },
];

// Sample chunks with mock embeddings (1536-dim zeros - real embeddings would come from OpenAI)
const EVAL_CHUNKS = [
  {
    id: EVAL_CHUNK_IDS[0],
    chunkIndex: 0,
    content: `Teacher training programs in rural Bihar have shown significant impact on student learning outcomes. A 2-year longitudinal study across 150 schools demonstrated 23% improvement in literacy rates among Grade 3 students and 18% improvement in numeracy skills.`,
    sectionTitle: "Impact Summary",
    tokenCount: 52,
  },
  {
    id: EVAL_CHUNK_IDS[1],
    chunkIndex: 1,
    content: `Key success factors for teacher training included: hands-on practice sessions rather than lecture-based training, peer mentoring networks among teachers, regular follow-up observations and feedback, and integration of local context and vernacular materials.`,
    sectionTitle: "Success Factors",
    tokenCount: 48,
  },
  {
    id: EVAL_CHUNK_IDS[2],
    chunkIndex: 2,
    content: `The KHEL project specifically focused on life skills education, incorporating social-emotional learning alongside academic content. Results showed improved student engagement and reduced dropout rates in participating schools.`,
    sectionTitle: "KHEL Project",
    tokenCount: 38,
  },
];

// Framework capabilities for tagging tests
const EVAL_CAPABILITIES = [
  {
    capabilityId: "C1",
    name: "Self-awareness",
    definitionShort: "Understanding one's emotions, strengths, weaknesses, and values",
    definitionLong: "Self-awareness involves recognizing one's own emotions, thoughts, and values and understanding how they influence behavior. It includes accurately assessing one's strengths and limitations with a well-grounded sense of confidence and optimism.",
  },
  {
    capabilityId: "C2",
    name: "Self-management",
    definitionShort: "Regulating emotions, thoughts, and behaviors effectively",
    definitionLong: "Self-management involves regulating one's emotions, thoughts, and behaviors effectively in different situations. This includes managing stress, controlling impulses, motivating oneself, and setting and working toward achieving personal and academic goals.",
  },
  {
    capabilityId: "C3",
    name: "Social awareness",
    definitionShort: "Understanding others' perspectives and empathizing with diverse backgrounds",
    definitionLong: "Social awareness is the ability to take the perspective of and empathize with others from diverse backgrounds and cultures, to understand social and ethical norms for behavior, and to recognize family, school, and community resources and supports.",
  },
];

// Mock embedding vector (1536 dimensions of small random values for cosine similarity)
function generateMockEmbedding(seed: number): number[] {
  const vec: number[] = [];
  for (let i = 0; i < 1536; i++) {
    // Deterministic pseudo-random based on seed and index
    const val = Math.sin(seed * 1000 + i) * 0.1;
    vec.push(val);
  }
  // Normalize to unit vector
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map((v) => v / norm);
}

async function seedEvalData() {
  console.log("Seeding eval test data...");

  // 1. Upsert framework capabilities
  console.log("  Seeding framework capabilities...");
  for (const cap of EVAL_CAPABILITIES) {
    await prisma.frameworkCapability.upsert({
      where: { capabilityId: cap.capabilityId },
      update: {},
      create: cap,
    });
  }

  // 2. Upsert evidence document
  console.log("  Seeding evidence document...");
  const doc = EVAL_DOCUMENTS[0];
  const evidenceDoc = await prisma.evidenceDocument.upsert({
    where: { driveFileId: doc.driveFileId },
    update: {
      cleanText: doc.cleanText,
      qualityTier: doc.qualityTier,
      qualityScore: doc.qualityScore,
    },
    create: doc,
  });

  // 3. Upsert document chunks with embeddings
  console.log("  Seeding document chunks with embeddings...");
  for (let i = 0; i < EVAL_CHUNKS.length; i++) {
    const chunk = EVAL_CHUNKS[i];

    // Upsert chunk
    const dbChunk = await prisma.documentChunk.upsert({
      where: { id: chunk.id },
      update: {
        content: chunk.content,
        sectionTitle: chunk.sectionTitle,
        tokenCount: chunk.tokenCount,
      },
      create: {
        id: chunk.id,
        documentId: evidenceDoc.id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        sectionTitle: chunk.sectionTitle,
        tokenCount: chunk.tokenCount,
      },
    });

    // Upsert embedding
    const embedding = generateMockEmbedding(i + 1);
    await prisma.chunkEmbedding.upsert({
      where: { chunkId: dbChunk.id },
      update: {
        vector: JSON.stringify(embedding),
      },
      create: {
        chunkId: dbChunk.id,
        embeddingModel: "text-embedding-3-small",
        vector: JSON.stringify(embedding),
      },
    });
  }

  // 4. Create a test pipeline entry for CRUD tests
  console.log("  Seeding test pipeline entry...");
  const testPipelineId = "eval-pipeline-001";
  await prisma.pipelineEntry.upsert({
    where: { id: testPipelineId },
    update: {},
    create: {
      id: testPipelineId,
      orgName: "Eval Test Foundation",
      stage: "lead",
      notes: "Seeded by funding-eval for CI tests",
    },
  });

  // 5. Create test opportunities for proposal tests
  // The proposal service expects jsonBlob.opportunity.funder structure
  console.log("  Seeding test opportunities...");
  const testOpportunities = [
    {
      opportunityId: "eval-opp-01",
      schemaVersion: "1.0",
      jsonBlob: {
        schemaVersion: "1.0",
        opportunity: {
          funder: {
            name: "Eval Test Funder",
            programName: "Education Grants",
          },
          keyConstraints: {
            deadline: "2025-12-31",
          },
          source: {
            attachments: [],
          },
          extractedRequirements: {
            summary: "Education grant for teacher training programs",
          },
        },
      },
      status: "extracted",
    },
    {
      opportunityId: "eval-proposal-opp-01",
      schemaVersion: "1.0",
      jsonBlob: {
        schemaVersion: "1.0",
        opportunity: {
          funder: {
            name: "Proposal Eval Funder",
            programName: "RFP 2025",
          },
          keyConstraints: {
            deadline: "2025-06-30",
          },
          source: {
            attachments: [],
          },
          extractedRequirements: {
            summary: "RFP for educational development programs",
          },
        },
      },
      status: "received",
    },
  ];

  for (const opp of testOpportunities) {
    await prisma.opportunity.upsert({
      where: { opportunityId: opp.opportunityId },
      update: {
        jsonBlob: opp.jsonBlob,
        status: opp.status,
      },
      create: opp,
    });
  }

  // Summary
  const docCount = await prisma.evidenceDocument.count();
  const chunkCount = await prisma.documentChunk.count();
  const embeddingCount = await prisma.chunkEmbedding.count();
  const capCount = await prisma.frameworkCapability.count();
  const oppCount = await prisma.opportunity.count();

  console.log("\nSeed complete:");
  console.log(`  Evidence documents: ${docCount}`);
  console.log(`  Document chunks: ${chunkCount}`);
  console.log(`  Chunk embeddings: ${embeddingCount}`);
  console.log(`  Framework capabilities: ${capCount}`);
  console.log(`  Opportunities: ${oppCount}`);
}

seedEvalData()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
