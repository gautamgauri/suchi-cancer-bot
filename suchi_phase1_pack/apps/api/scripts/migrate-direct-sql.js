#!/usr/bin/env node
/**
 * Direct SQL migration for Cloud Run Job
 * Adds missing columns to Session table using IF NOT EXISTS (safe for existing DB)
 */

const { PrismaClient } = require('@prisma/client');

const migrationSQL = `
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "userContext" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "cancerType" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "greetingCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "emotionalState" TEXT;
`;

async function runMigration() {
  const prisma = new PrismaClient();

  try {
    console.log('Running direct SQL migration...');
    await prisma.$executeRawUnsafe(migrationSQL);
    console.log('✅ Migration SQL executed successfully');

    // Verify columns exist
    console.log('Verifying columns...');
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'Session'
      AND column_name IN ('userContext', 'cancerType', 'greetingCompleted', 'emotionalState')
      ORDER BY column_name;
    `);

    if (result.length === 4) {
      console.log('✅ All 4 columns verified:');
      result.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
    } else {
      console.log(`⚠ Expected 4 columns, found ${result.length}`);
      result.forEach(row => {
        console.log(`  - ${row.column_name}`);
      });
    }

    await prisma.$disconnect();
    console.log('✅ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

runMigration();
