-- CreateTable
CREATE TABLE "VoiceInteraction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sttProvider" TEXT NOT NULL DEFAULT 'google',
    "sttConfidence" DOUBLE PRECISION,
    "transcript" TEXT NOT NULL,
    "audioDurationMs" INTEGER,
    "audioSizeBytes" INTEGER,
    "inputFormat" TEXT,
    "ttsProvider" TEXT NOT NULL DEFAULT 'google',
    "ttsAudioUrl" TEXT,
    "ttsVoiceName" TEXT,
    "sttLatencyMs" INTEGER,
    "ttsLatencyMs" INTEGER,
    "totalLatencyMs" INTEGER,
    "error" TEXT,

    CONSTRAINT "VoiceInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceInteraction_sessionId_idx" ON "VoiceInteraction"("sessionId");

-- CreateIndex
CREATE INDEX "VoiceInteraction_createdAt_idx" ON "VoiceInteraction"("createdAt");

-- AddForeignKey
ALTER TABLE "VoiceInteraction" ADD CONSTRAINT "VoiceInteraction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
