import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

@Injectable()
export class AudioConverterService {
  private readonly logger = new Logger(AudioConverterService.name);
  private readonly maxSizeBytes: number;
  private readonly maxDurationSec: number;

  constructor(private readonly config: ConfigService) {
    this.maxSizeBytes = this.config.get<number>("VOICE_MAX_AUDIO_SIZE_BYTES") || 2097152;
    this.maxDurationSec = this.config.get<number>("VOICE_MAX_AUDIO_DURATION_SEC") || 60;
  }

  async convertToLinear16(inputBuffer: Buffer, originalMimeType: string): Promise<{ wavBuffer: Buffer; durationMs: number }> {
    if (inputBuffer.length > this.maxSizeBytes) {
      throw new BadRequestException(`Audio file too large: ${inputBuffer.length} bytes (max ${this.maxSizeBytes})`);
    }

    const id = randomUUID();
    const inputPath = join("/tmp", `voice-in-${id}`);
    const outputPath = join("/tmp", `voice-out-${id}.wav`);

    try {
      await writeFile(inputPath, inputBuffer);

      // Probe duration
      const { stdout: probeOut } = await execFileAsync("ffprobe", [
        "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        inputPath,
      ]);
      const durationSec = parseFloat(probeOut.trim()) || 0;
      if (durationSec > this.maxDurationSec) {
        throw new BadRequestException(`Audio too long: ${durationSec.toFixed(1)}s (max ${this.maxDurationSec}s)`);
      }

      // Convert to WAV LINEAR16 16kHz mono
      await execFileAsync("ffmpeg", [
        "-y", "-i", inputPath,
        "-ar", "16000",
        "-ac", "1",
        "-f", "wav",
        "-acodec", "pcm_s16le",
        outputPath,
      ]);

      const wavBuffer = await readFile(outputPath);
      this.logger.log(`Audio converted: ${originalMimeType} -> WAV 16kHz mono | duration=${durationSec.toFixed(1)}s`);

      return { wavBuffer, durationMs: Math.round(durationSec * 1000) };
    } finally {
      unlink(inputPath).catch(() => {});
      unlink(outputPath).catch(() => {});
    }
  }
}
