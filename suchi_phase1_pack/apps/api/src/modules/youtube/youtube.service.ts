import { Injectable, Logger } from "@nestjs/common";
import { YoutubeTranscript } from "youtube-transcript";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import puppeteer from "puppeteer";

const execAsync = promisify(exec);

export interface VideoTranscript {
  videoId: string;
  title: string;
  text: string;
  segments: Array<{ text: string; start: number; duration: number }>;
  language: string;
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
   * Extract transcript using yt-dlp (more robust alternative)
   * Works even when YouTube Transcript API fails
   */
  private async getTranscriptWithYtDlp(videoId: string, preferredLang?: string): Promise<VideoTranscript> {
    const tmpFile = join(tmpdir(), `transcript-${videoId}-${Date.now()}.vtt`);

    try {
      this.logger.log(`Trying yt-dlp for video: ${videoId}`);

      // Build yt-dlp command with Node.js runtime and user-agent to avoid bot detection
      // --skip-download: don't download video
      // --write-auto-sub: download auto-generated subtitles
      // --write-sub: download manual subtitles
      // --sub-lang: preferred language
      // --convert-subs vtt: convert to WebVTT format (easier to parse)
      // --extractor-args "youtube:player_client=android": Use Android client to avoid bot detection
      // --user-agent: Pretend to be a browser
      const lang = preferredLang || 'hi,en';
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const cmd = `yt-dlp --skip-download --write-auto-sub --write-sub --sub-lang ${lang} --convert-subs vtt --user-agent "${userAgent}" --extractor-args "youtube:player_client=android" -o "${tmpFile.replace('.vtt', '')}" "https://www.youtube.com/watch?v=${videoId}"`;

      await execAsync(cmd, { timeout: 30000 });

      // Read the subtitle file
      const vttContent = await readFile(tmpFile, 'utf-8');

      // Parse VTT format
      const { text, segments, language } = this.parseVTT(vttContent);

      // Get video metadata with same user-agent and Android client
      const metaCmd = `yt-dlp --dump-json --skip-download --user-agent "${userAgent}" --extractor-args "youtube:player_client=android" "https://www.youtube.com/watch?v=${videoId}"`;
      const { stdout } = await execAsync(metaCmd, { timeout: 30000 });
      const metadata = JSON.parse(stdout);

      // Clean up temp file
      try {
        await unlink(tmpFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      return {
        videoId,
        title: metadata.title || `Onco Talks Episode - ${videoId}`,
        text,
        segments,
        language: language || 'hi'
      };
    } catch (error) {
      this.logger.error(`yt-dlp extraction failed: ${error.message}`);
      throw error;
    }
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
   * Extract transcript for a single video
   * Tries multiple methods: YouTube Transcript API first, then yt-dlp fallback
   */
  async getVideoTranscript(videoId: string, preferredLang?: string): Promise<VideoTranscript> {
    try {
      this.logger.log(`Fetching transcript for video: ${videoId}`);

      let transcriptData;
      let detectedLanguage = preferredLang || "en";
      let useYtDlp = false;

      // Method 1: Try YouTube Transcript API
      try {
        // Try preferred language first if specified
        if (preferredLang) {
          try {
            transcriptData = await YoutubeTranscript.fetchTranscript(videoId, {
              lang: preferredLang
            });
            detectedLanguage = preferredLang;
          } catch (error) {
            this.logger.warn(`Transcript not available in ${preferredLang}, trying other languages`);
          }
        }

        // If no preferred language or it failed, try English
        if (!transcriptData) {
          try {
            transcriptData = await YoutubeTranscript.fetchTranscript(videoId, {
              lang: 'en'
            });
            detectedLanguage = 'en';
          } catch (error) {
            this.logger.warn(`English transcript not available, trying Hindi`);
          }
        }

        // Try Hindi (common for Onco Talks)
        if (!transcriptData) {
          try {
            transcriptData = await YoutubeTranscript.fetchTranscript(videoId, {
              lang: 'hi'
            });
            detectedLanguage = 'hi';
          } catch (error) {
            this.logger.warn(`Hindi transcript not available, trying auto-generated`);
          }
        }

        // Last resort: fetch any available transcript
        if (!transcriptData) {
          transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
          detectedLanguage = 'auto';
        }
      } catch (error) {
        this.logger.warn(`YouTube Transcript API failed: ${error.message}. Trying yt-dlp...`);
        useYtDlp = true;
      }

      // Method 2: Try yt-dlp if API failed
      if (useYtDlp || !transcriptData) {
        try {
          return await this.getTranscriptWithYtDlp(videoId, preferredLang);
        } catch (ytdlpError) {
          this.logger.warn(`yt-dlp also failed: ${ytdlpError.message}. Trying Puppeteer...`);
          // Method 3: Fallback to Puppeteer (browser automation)
          return await this.getTranscriptWithPuppeteer(videoId, preferredLang);
        }
      }

      // Process YouTube Transcript API data
      const text = transcriptData.map(item => item.text).join("\n");
      const segments = transcriptData.map(item => ({
        text: item.text,
        start: item.offset / 1000,
        duration: item.duration / 1000
      }));

      const title = `Onco Talks Episode - ${videoId}`;

      this.logger.log(`Successfully fetched transcript in language: ${detectedLanguage}`);

      return {
        videoId,
        title,
        text,
        segments,
        language: detectedLanguage
      };
    } catch (error) {
      this.logger.error(`Error fetching transcript for ${videoId}: ${error.message}`);
      throw error;
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
