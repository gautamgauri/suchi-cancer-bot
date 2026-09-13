#!/usr/bin/env node
/**
 * Direct SQL migration script using pg library
 * Bypasses Prisma to connect directly via proxy
 */

const { Client } = require('pg');

const migrationSQL = `
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "userContext" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "cancerType" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "greetingCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "emotionalState" TEXT;
`;

async function runMigration() {
  const originalUrl = process.env.DATABASE_URL;
  
  if (!originalUrl) {
    console.error('DATABASE_URL not found in environment');
    process.exit(1);
  }

  // Parse URL and build connection config for proxy
  const url = new URL(originalUrl);
  const dbName = url.pathname.slice(1).split('?')[0];
  
  const config = {
    host: '127.0.0.1',  // Proxy is on localhost
    port: 5432,
    database: dbName,
    user: url.username,
    password: url.password,
    ssl: false  // Proxy handles SSL
  };

  console.log('Connecting to database via proxy at 127.0.0.1:5432...');
  console.log(`Database: ${config.database}, User: ${config.user}`);

  const client = new Client(config);

  try {
    await client.connect();
    console.log('✓ Connected to database');

    console.log('\nRunning migration SQL...');
    await client.query(migrationSQL);
    console.log('✓ Migration SQL executed successfully');

    // Verify columns exist
    console.log('\nVerifying columns...');
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'Session'
      AND column_name IN ('userContext', 'cancerType', 'greetingCompleted', 'emotionalState')
      ORDER BY column_name;
    `);

    if (result.rows.length === 4) {
      console.log('✓ All 4 columns verified:');
      result.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      });
    } else {
      console.log(`⚠ Expected 4 columns, found ${result.rows.length}`);
      result.rows.forEach(row => {
        console.log(`  - ${row.column_name}`);
      });
    }

    await client.end();
    console.log('\n✓ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    console.error('Error details:', error);
    await client.end();
    process.exit(1);
  }
}

runMigration();
