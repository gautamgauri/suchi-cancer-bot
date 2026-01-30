-- Add geolocation fields to Session for analytics
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "country" TEXT;
