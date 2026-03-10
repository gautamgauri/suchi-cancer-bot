const { YoutubeTranscript } = require("youtube-transcript");

async function testDownload(videoId) {
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
      textLength: fullText.length
    };
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
    return {
      success: false,
      videoId,
      error: error.message
    };
  }
}

const videoId = process.argv[2] || "jNQXAC9IVRw";
testDownload(videoId).then(() => console.log("Done!"));
