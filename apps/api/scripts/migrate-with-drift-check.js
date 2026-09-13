#!/usr/bin/env node
/**
 * Migration script with drift check and confirmation
 * Runs inside Cloud Run Job (has Cloud SQL access)
 * 
 * Flow:
 * 1. Check for schema drift (prisma migrate status)
 * 2. Apply migrations (prisma migrate deploy)
 * 3. Confirm expected columns exist
 */

const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');

async function runMigrationWithChecks() {
  const prisma = new PrismaClient();
  
  try {
    console.log('=== DB Drift Check ===');
    // Check migration status - will fail if there's drift
    // Use npm script to ensure correct Prisma version from package.json
    try {
      execSync('npm run prisma:migrate:deploy -- --dry-run 2>&1 || npx prisma migrate status', { stdio: 'inherit' });
      console.log('✅ No schema drift detected');
    } catch (error) {
      console.error('❌ Schema drift detected! Migrations are out of sync.');
      console.error('Run "npx prisma migrate status" locally to see details.');
      process.exit(1);
    }

    console.log('\n=== Running Migrations ===');
    // Apply pending migrations - use npm script to ensure correct Prisma version
    try {
      execSync('npm run prisma:migrate:deploy', { stdio: 'inherit' });
      console.log('✅ Migrations applied successfully');
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      process.exit(1);
    }

    console.log('\n=== Post-Migration Confirmation ===');
    // Verify expected columns exist
    const result = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Session' 
      AND column_name IN ('greetingCompleted', 'userContext', 'cancerType', 'emotionalState')
      ORDER BY column_name
    `;

    const found = result.map(r => r.column_name).sort();
    const expected = ['cancerType', 'emotionalState', 'greetingCompleted', 'userContext'].sort();
    
    if (found.length === expected.length && found.every((col, i) => col === expected[i])) {
      console.log('✅ Schema confirmation: All expected columns present');
      found.forEach(col => console.log(`  - ${col}`));
    } else {
      console.error('❌ Schema mismatch!');
      console.error('Expected:', expected);
      console.error('Found:', found);
      process.exit(1);
    }

    await prisma.$disconnect();
    console.log('\n✅ Migration complete with all checks passed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration process failed:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

runMigrationWithChecks();
