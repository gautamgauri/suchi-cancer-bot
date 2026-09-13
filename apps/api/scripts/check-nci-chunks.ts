#!/usr/bin/env ts-node
/**
 * Check NCI Chunks in Database
 * Queries the database to count NCI documents and chunks
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkNCIChunks() {
  try {
    console.log('📊 Checking NCI data in database...\n');

    // Count total NCI documents
    const nciDocCount = await prisma.kbDocument.count({
      where: {
        sourceType: '02_nci_core',
        status: 'active'
      }
    });

    // Count total NCI chunks
    const nciChunkResult = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count 
      FROM "KbChunk" c
      INNER JOIN "KbDocument" d ON c."docId" = d.id
      WHERE d."sourceType" = '02_nci_core' 
        AND d.status = 'active'
    `;
    const nciChunkCount = Number(nciChunkResult[0].count);

    // Count NCI chunks with embeddings
    const nciEmbeddedResult = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count 
      FROM "KbChunk" c
      INNER JOIN "KbDocument" d ON c."docId" = d.id
      WHERE d."sourceType" = '02_nci_core' 
        AND d.status = 'active'
        AND c.embedding IS NOT NULL
    `;
    const nciEmbeddedCount = Number(nciEmbeddedResult[0].count);

    // Get breakdown by source type
    const sourceTypeBreakdown = await prisma.$queryRaw<Array<{ sourceType: string | null; count: bigint }>>`
      SELECT d."sourceType", COUNT(*) as count
      FROM "KbDocument" d
      WHERE d.status = 'active'
      GROUP BY d."sourceType"
      ORDER BY count DESC
    `;

    // Get chunk breakdown by source type
    const chunkBreakdown = await prisma.$queryRaw<Array<{ sourceType: string | null; count: bigint; embedded: bigint }>>`
      SELECT 
        d."sourceType",
        COUNT(*) as count,
        COUNT(c.embedding) as embedded
      FROM "KbChunk" c
      INNER JOIN "KbDocument" d ON c."docId" = d.id
      WHERE d.status = 'active'
      GROUP BY d."sourceType"
      ORDER BY count DESC
    `;

    console.log('📈 NCI Data Summary:');
    console.log('─'.repeat(50));
    console.log(`✅ NCI Documents: ${nciDocCount.toLocaleString()}`);
    console.log(`✅ NCI Chunks: ${nciChunkCount.toLocaleString()}`);
    console.log(`✅ NCI Chunks with Embeddings: ${nciEmbeddedCount.toLocaleString()}`);
    console.log(`   (${((nciEmbeddedCount / nciChunkCount) * 100).toFixed(1)}% embedded)`);
    console.log('');

    console.log('📚 Documents by Source Type:');
    console.log('─'.repeat(50));
    for (const row of sourceTypeBreakdown) {
      const sourceType = row.sourceType || 'unknown';
      const count = Number(row.count);
      console.log(`  ${sourceType.padEnd(25)} ${count.toLocaleString().padStart(10)} documents`);
    }
    console.log('');

    console.log('🧩 Chunks by Source Type:');
    console.log('─'.repeat(50));
    for (const row of chunkBreakdown) {
      const sourceType = row.sourceType || 'unknown';
      const count = Number(row.count);
      const embedded = Number(row.embedded);
      const embeddedPct = count > 0 ? ((embedded / count) * 100).toFixed(1) : '0.0';
      console.log(`  ${sourceType.padEnd(25)} ${count.toLocaleString().padStart(10)} chunks (${embeddedPct}% embedded)`);
    }
    console.log('');

    // Total counts
    const totalDocs = await prisma.kbDocument.count({ where: { status: 'active' } });
    const totalChunks = await prisma.kbChunk.count();
    const totalEmbedded = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM "KbChunk" WHERE embedding IS NOT NULL
    `;
    const totalEmbeddedCount = Number(totalEmbedded[0].count);

    console.log('📊 Overall Database Summary:');
    console.log('─'.repeat(50));
    console.log(`  Total Documents: ${totalDocs.toLocaleString()}`);
    console.log(`  Total Chunks: ${totalChunks.toLocaleString()}`);
    console.log(`  Total Embedded Chunks: ${totalEmbeddedCount.toLocaleString()}`);
    if (totalChunks > 0) {
      console.log(`  NCI % of Total: ${((nciChunkCount / totalChunks) * 100).toFixed(1)}%`);
    }
    console.log('');

  } catch (error: any) {
    console.error('❌ Error querying database:', error.message);
    if (error.message.includes('P1001') || error.message.includes('connect')) {
      console.error('\n💡 Tip: Make sure DATABASE_URL is set and the database is accessible.');
      console.error('   For Cloud SQL, you may need to use Cloud SQL Proxy.');
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (require.main === module) {
  checkNCIChunks().catch((error) => {
    console.error('❌ Script crashed:', error);
    process.exit(1);
  });
}
