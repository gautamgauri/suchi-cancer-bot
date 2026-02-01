-- Add isEval column to Session table to mark eval/test traffic
ALTER TABLE "Session" ADD COLUMN "isEval" BOOLEAN NOT NULL DEFAULT false;

-- Create index for efficient filtering
CREATE INDEX "Session_isEval_idx" ON "Session"("isEval");
