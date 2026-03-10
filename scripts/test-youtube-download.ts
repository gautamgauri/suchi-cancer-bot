#!/usr/bin/env ts-node
/**
 * Test script to download YouTube transcripts locally
 * Usage: ts-node test-youtube-download.ts VIDEO_ID
 */

import { YoutubeTranscript } from "youtube-transcript";

async function testDownload(videoId: string) {
  console.log(`\nFetching transcript for video: ${videoId}`);
  console.log(`URL: https://www.youtube.com/watch?v=${videoId}\n`);

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    console.log(`✓ Successfully fetched transcript`);
    console.log(`  - Segments: ${transcript.length}`);

    const fullText = transcript.map(item => item.text).join("\n");
    console.log(`  - Total length: ${fullText.length} characters`);
    console.log(`\n--- Preview (first 500 chars) ---`);
    console.log(fullText.substring(0, 500));
    console.log(`\n--- End preview ---\n`);

    return {
      success: true,
      videoId,
      segmentCount: transcript.length,
      textLength: fullText.length,
      fullText
    };
  } catch (error: any) {
    console.error(`✗ Error: ${error.message}`);
    return {
      success: false,
      videoId,
      error: error.message
    };
  }
}

// Get video ID from command line
const videoId = process.argv[2];

if (!videoId) {
  console.error("Usage: ts-node test-youtube-download.ts VIDEO_ID");
  console.error("Example: ts-node test-youtube-download.ts dQw4w9WgXcQ");
  process.exit(1);
}

testDownload(videoId).then(() => {
  console.log("Done!");
});
