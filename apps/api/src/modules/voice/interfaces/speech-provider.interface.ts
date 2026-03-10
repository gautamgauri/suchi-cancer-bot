export const STT_PROVIDER = Symbol("STT_PROVIDER");
export const TTS_PROVIDER = Symbol("TTS_PROVIDER");

export interface SttResult {
  transcript: string;
  confidence: number;
  languageCode: string;
}

export interface SttProvider {
  transcribe(audioBuffer: Buffer, languageCode?: string): Promise<SttResult>;
}

export interface TtsResult {
  audioContent: Buffer;
  audioEncoding: string;
}

export interface TtsProvider {
  synthesize(ssml: string, voiceName?: string, locale?: string): Promise<TtsResult>;
}
