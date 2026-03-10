import * as fs from 'fs/promises';
import * as path from 'path';
import { VoiceTestCase } from '../types/voice';
import { execSync } from 'child_process';

/**
 * Synthesizes test audio from expected transcripts using Google TTS.
 * Supports variant modifications: speed, noise.
 */
export class AudioSynthesizer {
  private readonly fixturesDir: string;

  constructor(fixturesDir: string) {
    this.fixturesDir = fixturesDir;
  }

  /**
   * Generate WAV audio file for a test case using Google TTS.
   * Applies variant modifications (speed, noise) via ffmpeg.
   */
  async synthesize(testCase: VoiceTestCase): Promise<string> {
    await fs.mkdir(this.fixturesDir, { recursive: true });

    const outputPath = path.join(
      this.fixturesDir,
      `${testCase.id}.wav`,
    );

    // Check if fixture already exists
    try {
      await fs.access(outputPath);
      console.log(`  Using cached fixture: ${testCase.id}.wav`);
      return outputPath;
    } catch {
      // File doesn't exist, synthesize it
    }

    console.log(
      `  Synthesizing audio for ${testCase.id} (${testCase.variant})...`,
    );

    // Use Google TTS to generate base audio
    const ttsClient = await this.getTtsClient();
    const voiceName = testCase.locale === 'hi-IN' ? 'hi-IN-Neural2-A' : 'en-IN-Neural2-A';

    const [response] = await ttsClient.synthesizeSpeech({
      input: { text: testCase.expectedTranscript },
      voice: {
        languageCode: testCase.locale,
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: 'LINEAR16' as any,
        sampleRateHertz: 16000,
        speakingRate: 1.0, // We'll adjust speed with ffmpeg for more control
      },
    });

    const baseAudioPath = path.join(
      this.fixturesDir,
      `${testCase.id}_base.wav`,
    );
    await fs.writeFile(baseAudioPath, response.audioContent as Buffer);

    // Apply variant modifications via ffmpeg
    const speakingRate = testCase.synthetic?.speakingRate ?? 1.0;
    const addNoise = testCase.synthetic?.addNoise ?? false;

    if (speakingRate !== 1.0 || addNoise) {
      const filters: string[] = [];

      // Speed adjustment using atempo
      if (speakingRate !== 1.0) {
        // atempo only supports 0.5-2.0, chain for extreme values
        let rate = speakingRate;
        while (rate > 2.0) {
          filters.push('atempo=2.0');
          rate /= 2.0;
        }
        while (rate < 0.5) {
          filters.push('atempo=0.5');
          rate /= 0.5;
        }
        filters.push(`atempo=${rate}`);
      }

      let ffmpegCmd: string;

      if (addNoise) {
        // Generate white noise and mix with audio
        const noiseLevel = testCase.synthetic?.noiseLevel ?? 0.05;
        // Use anoisesrc and amix for noise mixing
        ffmpegCmd = `ffmpeg -y -i "${baseAudioPath}" -f lavfi -i "anoisesrc=d=60:c=white:a=${noiseLevel}" -filter_complex "[0:a]${filters.length > 0 ? filters.join(',') + '[a];[a]' : ''}[1:a]amix=inputs=2:duration=first:dropout_transition=0[out]" -map "[out]" -ar 16000 -ac 1 -acodec pcm_s16le "${outputPath}"`;
      } else if (filters.length > 0) {
        ffmpegCmd = `ffmpeg -y -i "${baseAudioPath}" -af "${filters.join(',')}" -ar 16000 -ac 1 -acodec pcm_s16le "${outputPath}"`;
      } else {
        ffmpegCmd = `ffmpeg -y -i "${baseAudioPath}" -ar 16000 -ac 1 -acodec pcm_s16le "${outputPath}"`;
      }

      try {
        execSync(ffmpegCmd, { stdio: 'pipe' });
      } catch (err: any) {
        console.warn(
          `  ffmpeg failed, using base audio: ${err.message}`,
        );
        await fs.copyFile(baseAudioPath, outputPath);
      }
    } else {
      await fs.copyFile(baseAudioPath, outputPath);
    }

    // Cleanup base file
    await fs.unlink(baseAudioPath).catch(() => {});

    return outputPath;
  }

  /**
   * Synthesize all test cases.
   */
  async synthesizeAll(
    testCases: VoiceTestCase[],
  ): Promise<Map<string, string>> {
    const audioFiles = new Map<string, string>();

    for (const tc of testCases) {
      const filePath = await this.synthesize(tc);
      audioFiles.set(tc.id, filePath);
    }

    return audioFiles;
  }

  private async getTtsClient() {
    const { TextToSpeechClient } = await import(
      '@google-cloud/text-to-speech'
    );
    return new TextToSpeechClient();
  }
}
