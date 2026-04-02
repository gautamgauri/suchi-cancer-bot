import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class VoiceRequestDto {
  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsString()
  locale?: string;
}

export class TtsRequestDto {
  @IsString()
  @MaxLength(5000)
  text!: string;

  @IsOptional()
  @IsString()
  locale?: string;
}

export interface TtsResponse {
  audioUrl: string;
}

export interface VoiceResponse {
  sessionId: string;
  messageId?: string;
  transcript: string;
  confidence: number;
  responseText: string;
  voiceResponseText: string;
  audioUrl: string | null;
  safety: { classification: string; actions: string[] };
  latency: {
    sttMs: number;
    chatMs: number;
    ttsMs: number;
    totalMs: number;
  };
}
