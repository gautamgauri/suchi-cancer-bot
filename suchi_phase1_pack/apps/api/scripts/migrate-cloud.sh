#!/bin/bash
# Database migration script for Cloud SQL
# This script runs Prisma migrations on a Cloud SQL instance

set -e

echo "Starting database migration for Cloud SQL..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL environment variable is not set"
    echo "Please set it to your Cloud SQL connection string"
    exit 1
fi

# Navigate to API directory
cd "$(dirname "$0")/../.." || exit 1

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Generate Prisma client
echo "Generating Prisma client..."
npx prisma generate

# Verify pgvector extension (optional check)
echo "Verifying pgvector extension..."
PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p') \
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" || {
    echo "Warning: Could not verify pgvector extension. Make sure it's installed on your Cloud SQL instance."
}

# Run migrations
echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Migration completed successfully!"

# Optional: Verify migration
echo "Verifying migration status..."
npx prisma migrate status

echo "Done!"











