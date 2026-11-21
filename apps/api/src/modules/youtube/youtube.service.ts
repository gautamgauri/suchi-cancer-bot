import { Injectable, Logger } from "@nestjs/common";
import { YoutubeTranscript } from "youtube-transcript";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, unlink, readdir } from "fs/promises";
import { join, basename, dirname } from "path";
import { tmpdir } from "os";
import puppeteer from "puppeteer";

const execAsync = promisify(exec);

/**
 * Minimum usable transcript length, in characters.
 *
 * Guard for issue #91 (a): `youtube-transcript@1.2.1` does not throw when a
 * video has no captions — it resolves with an EMPTY ARRAY. An empty array is
 * truthy, so the old `if (!transcriptData)` fallback chain never fired and the
 * caller happily wrote an empty KB document. Length is checked explicitly at
 * every hand-off from here on.
 *
 * ~763 chars/minute is the measured caption density for this channel, so 400
 * chars is roughly 30 seconds of speech: below that there is nothing to ingest.
 */
export const MIN_TRANSCRIPT_CHARS = 400;

const YT_DLP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface VideoTranscript {
  videoId: string;
  title: string;
  text: string;
  segments: Array<{ text: string; start: number; duration: number }>;
  language: string;
  /** The caption track actually used, e.g. `hi-orig`, `en`. */
  captionTrack?: string;
  /** True when captions came from automatic speech recognition. */
  machineGenerated?: boolean;
  /**
   * True when the track is YouTube's machine TRANSLATION of a machine
   * transcription. YouTube offers auto-translated captions in ~150 languages
   * for any video with ASR, so asking for `en` on a Hindi video silently
   * returns a translation of a transcription — two lossy machine steps stacked.
   * Never acceptable as KB evidence.
   */
  machineTranslated?: boolean;
}

/**
 * An empty array is truthy. Every "did we get a transcript?" check must go
 * through here. See MIN_TRANSCRIPT_CHARS.
 */
export function hasSegments(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function transcriptTextLength(segments: Array<{ text?: string }>): number {
  return segments.reduce((n, s) => n + (s?.text?.length ?? 0), 0);
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);

  /**
   * Fetch video IDs from a YouTube channel
   */
  async getChannelVideos(channelUrl: string, maxVideos: number = 50): Promise<string[]> {
    try {
      // For now, we'll accept a list of video IDs or URLs
      // Full channel scraping requires additional packages like youtube-sr or puppeteer
      this.logger.warn("Full channel scraping not implemented. Provide video IDs directly.");
      return [];
    } catch (error) {
      this.logger.error(`Error fetching channel videos: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract transcript using Puppeteer (browser automation - most reliable)
   * Opens the video page and extracts visible transcript like Comet browser
   */
  private async getTranscriptWithPuppeteer(videoId: string, preferredLang?: string): Promise<VideoTranscript> {
    this.logger.log(`Trying Puppeteer browser automation for video: ${videoId}`);

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    try {
      const page = await browser.newPage();

      // Set viewport and user agent
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Navigate to video - use simple URL with longer timeout
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      this.logger.log(`Opening URL: ${videoUrl}`);

      // Go to page and wait for it to be fully loaded
      await page.goto(videoUrl, {
        waitUntil: 'networkidle0',
        timeout: 60000
      });

      // Wait for page to be fully stable (avoid frame issues)
      await new Promise(resolve => setTimeout(resolve, 5000));

      this.logger.log('Page loaded, extracting data...');

      // Get all data in one evaluation to avoid detached frame issues
      const result = await page.evaluate(() => {
        // Get title
        const titleElement = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string') ||
                            document.querySelector('h1 yt-formatted-string') ||
                            document.querySelector('h1.title');
        const title = titleElement?.textContent?.trim() || '';

        // Try to find and click transcript button
        const buttons = Array.from(document.querySelectorAll('button'));
        const transcriptButton = buttons.find(btn =>
          btn.textContent?.toLowerCase().includes('transcript') ||
          btn.getAttribute('aria-label')?.toLowerCase().includes('transcript')
        );

        if (transcriptButton) {
          (transcriptButton as HTMLElement).click();
        }

        return { title };
      });

      // Wait for transcript panel to appear
      this.logger.log('Waiting for transcript panel...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Extract transcript segments
      this.logger.log('Extracting transcript segments...');
      const transcriptData = await page.evaluate(() => {
        const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));

        if (segments.length === 0) {
          return null;
        }

        return segments.map(segment => {
          const timeElement = segment.querySelector('.segment-timestamp');
          const textElement = segment.querySelector('.segment-text');

          const timeStr = timeElement?.textContent?.trim() || '0:00';
          const text = textElement?.textContent?.trim() || '';

          const timeParts = timeStr.split(':').map(Number).reverse();
          const seconds = timeParts[0] + (timeParts[1] || 0) * 60 + (timeParts[2] || 0) * 3600;

          return {
            text,
            start: seconds,
            duration: 5
          };
        });
      });

      if (!transcriptData || transcriptData.length === 0) {
        throw new Error('Transcript panel not found or empty. Video may not have captions enabled.');
      }

      const fullText = transcriptData.map(s => s.text).join('\n');
      const detectedLang = preferredLang || 'hi';

      this.logger.log(`Successfully extracted ${transcriptData.length} transcript segments via Puppeteer`);

      return {
        videoId,
        title: result.title || `Onco Talks Episode - ${videoId}`,
        text: fullText,
        segments: transcriptData,
        language: detectedLang
      };

    } finally {
      await browser.close();
    }
  }

  /**
   * List the automatic caption tracks YouTube exposes for a video and identify
   * the ORIGINAL-language one.
   *
   * YouTube publishes two kinds of automatic caption track:
   *   - `<lang>-orig` — ASR of the language actually spoken.
   *   - `<lang>`      — machine TRANSLATION of that ASR, offered in ~150
   *                     languages for any video that has ASR at all.
   *
   * The old code asked for `--sub-lang hi,en`, which on this channel's videos
   * silently returned a translated track: a machine translation of a machine
   * transcription. Two lossy steps stacked, on medical content. We resolve the
   * `-orig` track explicitly and record when we could not.
   */
  async resolveCaptionTrack(
    videoId: string,
    preferredLang?: string,
  ): Promise<{ track: string; language: string; machineTranslated: boolean } | null> {
    const metadata = await this.getVideoMetadata(videoId);
    const auto = (metadata?.automatic_captions ?? {}) as Record<string, unknown>;
    const manual = (metadata?.subtitles ?? {}) as Record<string, unknown>;

    // A human-authored track always wins.
    for (const lang of [preferredLang, "en", "hi"].filter(Boolean) as string[]) {
      if (manual[lang]) return { track: lang, language: lang, machineTranslated: false };
    }

    const origTracks = Object.keys(auto).filter((k) => k.endsWith("-orig"));
    if (origTracks.length > 0) {
      const preferredOrig = preferredLang
        ? origTracks.find((t) => t === `${preferredLang}-orig`)
        : undefined;
      const track = preferredOrig ?? origTracks[0];
      return { track, language: track.replace(/-orig$/, ""), machineTranslated: false };
    }

    // No original track. Anything else on offer is a machine translation; the
    // caller decides whether that is acceptable (for the KB it is not).
    const fallback = [preferredLang, "en", "hi"].find((l) => l && auto[l]);
    if (fallback) return { track: fallback, language: fallback, machineTranslated: true };

    return null;
  }

  /** `yt-dlp --dump-json`, parsed. Returns null when the video is unavailable. */
  async getVideoMetadata(videoId: string): Promise<any | null> {
    const cmd = `yt-dlp --dump-json --skip-download --no-warnings --user-agent "${YT_DLP_USER_AGENT}" "https://www.youtube.com/watch?v=${videoId}"`;
    try {
      const { stdout } = await execAsync(cmd, { timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) {
      this.logger.warn(`yt-dlp metadata failed for ${videoId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract transcript using yt-dlp.
   *
   * Two defects fixed here beyond the language selection above:
   *   1. yt-dlp writes `<template>.<lang>.vtt`, never `<template>.vtt`. The old
   *      code passed `-o <base>` and then read `<base>.vtt`, which does not
   *      exist — so this fallback could only ever throw ENOENT. It was dead
   *      code that looked like a working fallback.
   *   2. An empty/whitespace-only subtitle file was accepted as success.
   */
  private async getTranscriptWithYtDlp(videoId: string, preferredLang?: string): Promise<VideoTranscript> {
    const outputBase = join(tmpdir(), `transcript-${videoId}-${Date.now()}`);
    const writtenFiles: string[] = [];

    try {
      this.logger.log(`Trying yt-dlp for video: ${videoId}`);

      const resolved = await this.resolveCaptionTrack(videoId, preferredLang);
      if (!resolved) {
        throw new Error(`No caption track available for ${videoId}`);
      }
      if (resolved.machineTranslated) {
        this.logger.warn(
          `Only a machine-TRANSLATED caption track (${resolved.track}) is available for ${videoId}. ` +
            `This is a translation of a transcription and is not acceptable as KB evidence.`,
        );
      }

      // json3, not VTT. YouTube's auto-caption VTT is a ROLLING format: each
      // cue repeats the tail of the previous one, so a naive parse duplicates
      // roughly every line and inflates the text ~2x — which then gets embedded
      // twice. json3 carries one event per utterance with exact timings.
      const cmd =
        `yt-dlp --skip-download --write-auto-sub --write-sub ` +
        `--sub-langs "${resolved.track}" --sub-format json3 --no-warnings ` +
        `--user-agent "${YT_DLP_USER_AGENT}" -o "${outputBase}" ` +
        `"https://www.youtube.com/watch?v=${videoId}"`;

      await execAsync(cmd, { timeout: 120000, maxBuffer: 32 * 1024 * 1024 });

      // yt-dlp names the file `<base>.<track>.vtt`; find whatever it produced.
      const dir = dirname(outputBase);
      const prefix = basename(outputBase);
      const candidates = (await readdir(dir))
        .filter((f) => f.startsWith(prefix) && (f.endsWith(".json3") || f.endsWith(".vtt")))
        .sort((a, b) => Number(b.endsWith(".json3")) - Number(a.endsWith(".json3")))
        .map((f) => join(dir, f));
      writtenFiles.push(...candidates);

      if (candidates.length === 0) {
        throw new Error(`yt-dlp produced no subtitle file for ${videoId} (track ${resolved.track})`);
      }

      const content = await readFile(candidates[0], "utf-8");
      const { text, segments } = candidates[0].endsWith(".json3")
        ? this.parseJson3(content)
        : this.parseVTT(content);

      if (!hasSegments(segments) || text.trim().length < MIN_TRANSCRIPT_CHARS) {
        throw new Error(
          `yt-dlp returned a transcript of ${text.trim().length} chars for ${videoId} ` +
            `(minimum ${MIN_TRANSCRIPT_CHARS}); refusing to treat it as usable`,
        );
      }

      const metadata = await this.getVideoMetadata(videoId);

      return {
        videoId,
        title: metadata?.title || `Onco Talks Episode - ${videoId}`,
        text,
        segments,
        language: resolved.language,
        captionTrack: resolved.track,
        machineGenerated: true,
        machineTranslated: resolved.machineTranslated,
      };
    } catch (error) {
      this.logger.error(`yt-dlp extraction failed: ${error.message}`);
      throw error;
    } finally {
      await Promise.all(
        writtenFiles.map((f) => unlink(f).catch(() => undefined)),
      );
    }
  }

  /**
   * Parse YouTube's `json3` caption format.
   *
   * One event per utterance, each with `tStartMs`/`dDurationMs` and a list of
   * word segments. Unlike VTT this is not a rolling format, so there is nothing
   * to de-duplicate and the timings are exact — which is what makes the `?t=`
   * deep links on each KB section trustworthy.
   */
  parseJson3(content: string): { text: string; segments: any[]; language: string } {
    const parsed = JSON.parse(content);
    const segments: any[] = [];

    for (const event of parsed?.events ?? []) {
      if (!Array.isArray(event.segs)) continue;
      const text = event.segs
        .map((seg: any) => seg?.utf8 ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      segments.push({
        text,
        start: (event.tStartMs ?? 0) / 1000,
        duration: (event.dDurationMs ?? 0) / 1000,
      });
    }

    return { text: segments.map((s) => s.text).join("\n"), segments, language: "auto" };
  }

  /**
   * Parse WebVTT subtitle format
   */
  private parseVTT(vttContent: string): { text: string; segments: any[]; language: string } {
    const lines = vttContent.split('\n');
    const segments: any[] = [];
    let currentText = '';
    let currentStart = 0;
    let currentDuration = 0;
    let detectedLanguage = 'auto';

    // Extract language from WEBVTT header if present
    const langMatch = vttContent.match(/Language:\s*(\w+)/i);
    if (langMatch) {
      detectedLanguage = langMatch[1];
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip WEBVTT header and empty lines
      if (line.startsWith('WEBVTT') || line === '' || line.match(/^\d+$/)) {
        continue;
      }

      // Timestamp line (e.g., "00:00:01.000 --> 00:00:05.000")
      const timestampMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
      if (timestampMatch) {
        const startTime = this.parseTimestamp(timestampMatch[1]);
        const endTime = this.parseTimestamp(timestampMatch[2]);
        currentStart = startTime;
        currentDuration = endTime - startTime;

        // Next line(s) contain the text
        i++;
        const textLines = [];
        while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^\d{2}:\d{2}:\d{2}/)) {
          // Remove VTT tags like <c> or alignment tags
          const cleanText = lines[i].trim().replace(/<[^>]+>/g, '');
          if (cleanText) {
            textLines.push(cleanText);
          }
          i++;
        }

        currentText = textLines.join(' ');

        if (currentText) {
          segments.push({
            text: currentText,
            start: currentStart,
            duration: currentDuration
          });
        }

        i--; // Step back one line as the loop will increment
      }
    }

    const fullText = segments.map(s => s.text).join('\n');

    return {
      text: fullText,
      segments,
      language: detectedLanguage
    };
  }

  /**
   * Parse VTT timestamp to seconds
   */
  private parseTimestamp(timestamp: string): number {
    const parts = timestamp.split(':');
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Extract transcript for a single video.
   *
   * Order: `youtube-transcript` npm package → yt-dlp → Puppeteer.
   *
   * ISSUE #91 (a) — THE BUG THIS METHOD USED TO HAVE
   * ------------------------------------------------
   * `youtube-transcript@1.2.1` does not throw when a video has no captions in
   * the requested language: it RESOLVES WITH AN EMPTY ARRAY. Every fallback in
   * the old chain was guarded by `if (!transcriptData)`, and `[]` is truthy, so
   * the method concluded it had succeeded, never reached yt-dlp or Puppeteer,
   * and returned a transcript with zero segments and an empty `text`. The
   * caller then wrote an empty markdown file and a manifest entry for it.
   *
   * Every check now goes through `hasSegments()`, and the result is
   * length-checked against MIN_TRANSCRIPT_CHARS before being returned, so an
   * empty transcript raises instead of propagating.
   */
  async getVideoTranscript(videoId: string, preferredLang?: string): Promise<VideoTranscript> {
    try {
      this.logger.log(`Fetching transcript for video: ${videoId}`);

      let transcriptData: Array<{ text: string; offset: number; duration: number }> | undefined;
      let detectedLanguage = preferredLang || "en";

      // Method 1: youtube-transcript npm package.
      const attempts: Array<{ lang?: string; label: string }> = [];
      if (preferredLang) attempts.push({ lang: preferredLang, label: preferredLang });
      attempts.push({ lang: "en", label: "en" }, { lang: "hi", label: "hi" }, { lang: undefined, label: "auto" });

      for (const attempt of attempts) {
        if (hasSegments(transcriptData)) break;
        try {
          const result = attempt.lang
            ? await YoutubeTranscript.fetchTranscript(videoId, { lang: attempt.lang })
            : await YoutubeTranscript.fetchTranscript(videoId);
          if (hasSegments(result)) {
            transcriptData = result as any;
            detectedLanguage = attempt.label;
          } else {
            // NOT an error path in the library — this is the empty-array case.
            this.logger.warn(
              `youtube-transcript returned 0 segments for ${videoId} (${attempt.label}); treating as unavailable`,
            );
          }
        } catch (error) {
          this.logger.warn(`youtube-transcript failed for ${videoId} (${attempt.label}): ${error.message}`);
        }
      }

      // Method 2/3: yt-dlp, then Puppeteer. Reached whenever method 1 yielded
      // nothing — including the empty-array case that used to be swallowed.
      if (!hasSegments(transcriptData) || transcriptTextLength(transcriptData ?? []) < MIN_TRANSCRIPT_CHARS) {
        try {
          return await this.getTranscriptWithYtDlp(videoId, preferredLang);
        } catch (ytdlpError) {
          this.logger.warn(`yt-dlp failed: ${ytdlpError.message}. Trying Puppeteer...`);
          const viaBrowser = await this.getTranscriptWithPuppeteer(videoId, preferredLang);
          this.assertUsable(viaBrowser);
          return viaBrowser;
        }
      }

      const text = transcriptData!.map((item) => item.text).join("\n");
      const segments = transcriptData!.map((item) => ({
        text: item.text,
        start: item.offset / 1000,
        duration: item.duration / 1000,
      }));

      const result: VideoTranscript = {
        videoId,
        title: `Onco Talks Episode - ${videoId}`,
        text,
        segments,
        language: detectedLanguage,
        captionTrack: detectedLanguage,
        machineGenerated: true,
      };
      this.assertUsable(result);

      this.logger.log(`Successfully fetched transcript in language: ${detectedLanguage}`);
      return result;
    } catch (error) {
      this.logger.error(`Error fetching transcript for ${videoId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Refuse to hand an unusable transcript to the KB writer.
   * This is the guard whose absence let empty documents into `manifest.json`.
   */
  assertUsable(transcript: VideoTranscript): void {
    if (!hasSegments(transcript?.segments)) {
      throw new Error(`Transcript for ${transcript?.videoId} has no segments; refusing to use it`);
    }
    const length = (transcript.text ?? "").trim().length;
    if (length < MIN_TRANSCRIPT_CHARS) {
      throw new Error(
        `Transcript for ${transcript.videoId} is ${length} chars (minimum ${MIN_TRANSCRIPT_CHARS}); refusing to use it`,
      );
    }
  }

  /**
   * Batch process multiple video IDs
   */
  async batchGetTranscripts(videoIds: string[]): Promise<VideoTranscript[]> {
    const results: VideoTranscript[] = [];

    for (const videoId of videoIds) {
      try {
        const transcript = await this.getVideoTranscript(videoId);
        results.push(transcript);

        // Rate limiting: wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        this.logger.error(`Failed to process ${videoId}: ${error.message}`);
        // Continue with other videos
      }
    }

    return results;
  }

  /**
   * Extract video ID from various YouTube URL formats
   */
  extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }
}
