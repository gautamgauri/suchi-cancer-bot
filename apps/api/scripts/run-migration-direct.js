#!/usr/bin/env node
/**
 * Direct SQL migration script
 * Runs the migration SQL directly against Cloud SQL via proxy
 * Uses Prisma Client to execute raw SQL
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const migrationSQL = `
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "userContext" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "cancerType" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "greetingCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "emotionalState" TEXT;
`;

async function runMigration() {
  // Modify DATABASE_URL to use 127.0.0.1:5432 (proxy) - explicitly use IPv4
  const originalUrl = process.env.DATABASE_URL;
  
  console.log('=== DATABASE_URL Debug ===');
  console.log('Original DATABASE_URL:', originalUrl ? originalUrl.substring(0, 80) + '...' : 'NOT SET');
  
  if (!originalUrl) {
    console.error('DATABASE_URL not found in environment');
    process.exit(1);
  }

  // Parse the original URL - it may have Unix socket path in query params
  // Format: postgresql://user:pass@localhost/db?host=/cloudsql/...
  const url = new URL(originalUrl);
  const dbName = url.pathname.slice(1).split('?')[0]; // Remove leading / and query params
  
  // Build new URL for TCP connection via proxy - MUST use 127.0.0.1 (not localhost) to avoid IPv6
  const proxyUrl = `postgresql://${url.username}:${url.password}@127.0.0.1:5432/${dbName}`;
  
  console.log('Proxy DATABASE_URL:', proxyUrl.substring(0, 50) + '...');
  console.log('Connecting to database via proxy at 127.0.0.1:5432...');
  console.log(`Database: ${dbName}, User: ${url.username}`);

  // Temporarily override DATABASE_URL for Prisma
  // Must set BEFORE importing/creating PrismaClient
  process.env.DATABASE_URL = proxyUrl;
  console.log('DATABASE_URL set for Prisma');
  console.log('Verifying env var:', process.env.DATABASE_URL.substring(0, 50) + '...');

  // Create PrismaClient with explicit datasources override
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: proxyUrl
      }
    }
  });

  try {
    console.log('\nRunning migration SQL...');
    await prisma.$executeRawUnsafe(migrationSQL);
    console.log('✓ Migration SQL executed successfully');

    // Verify columns exist
    console.log('\nVerifying columns...');
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'Session'
      AND column_name IN ('userContext', 'cancerType', 'greetingCompleted', 'emotionalState')
      ORDER BY column_name;
    `);

    if (result.length === 4) {
      console.log('✓ All 4 columns verified:');
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
    console.log('\n✓ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

runMigration();
