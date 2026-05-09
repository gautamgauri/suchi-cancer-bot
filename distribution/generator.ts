import * as fs from "node:fs/promises";
import * as path from "node:path";
import { VertexAI } from "@google-cloud/vertexai";
import { ParsedArticle } from "./parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelName =
  | "linkedin"
  | "twitter"
  | "instagram"
  | "whatsapp"
  | "youtube_short";

export interface ChannelResult {
  channel: ChannelName;
  content: string; // raw generated text
  status: "ok" | "failed";
  error?: string;
  generatedAt: string; // ISO timestamp
}

export interface GeneratedPack {
  articleSlug: string;
  articleTitle: string;
  articleUrl: string;
  generatedAt: string;
  channels: Record<ChannelName, ChannelResult>;
}

// ---------------------------------------------------------------------------
// File-name → channel mapping
// ---------------------------------------------------------------------------

const FILE_TO_CHANNEL: Record<string, ChannelName> = {
  "linkedin.md": "linkedin",
  "twitter.md": "twitter",
  "instagram.md": "instagram",
  "whatsapp.md": "whatsapp",
  "youtube-short.md": "youtube_short",
};

const CHANNEL_FILES = Object.keys(FILE_TO_CHANNEL) as Array<
  keyof typeof FILE_TO_CHANNEL
>;

// ---------------------------------------------------------------------------
// Vertex AI model (constructed once)
// ---------------------------------------------------------------------------

const vertexAI = new VertexAI({
  project: process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0202543132",
  location: "us-central1",
});

const baseModel = vertexAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-2.0-flash-001",
  generationConfig: { temperature: 0.4, maxOutputTokens: 2000 },
});

// Higher temperature for channels that benefit from human texture and warmth;
// lower for channels where precision and brevity matter most.
const CHANNEL_TEMPERATURE: Record<ChannelName, number> = {
  linkedin:      0.4, // institutional audience — consistency over creativity
  twitter:       0.5, // factual but needs personality
  whatsapp:      0.4, // short and precise — no room for drift
  instagram:     0.6, // visual-first, benefits from warmth and rhythm
  youtube_short: 0.65, // conversational script — most human of all channels
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fill template placeholders with article data. */
function fillTemplate(template: string, article: ParsedArticle): string {
  return template
    .replace(/\{\{ARTICLE_BODY\}\}/g, article.body)
    .replace(/\{\{ARTICLE_URL\}\}/g, article.canonicalUrl)
    .replace(/\{\{ARTICLE_TITLE\}\}/g, article.title);
}

/** Generate content for a single channel with a 30-second timeout. */
async function generateChannel(
  channel: ChannelName,
  prompt: string,
): Promise<ChannelResult> {
  const generatedAt = new Date().toISOString();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Channel "${channel}" timed out after 30 s`)),
      30_000,
    ),
  );

  const generatePromise = (async () => {
    const result = await baseModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: CHANNEL_TEMPERATURE[channel] },
    });
    const text =
      result.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return text;
  })();

  try {
    const content = await Promise.race([generatePromise, timeoutPromise]);
    console.log(`[generator] ✓ ${channel} — ${content.length} chars`);
    return { channel, content, status: "ok", generatedAt };
  } catch (err: any) {
    const error: string =
      err instanceof Error ? err.message : String(err);
    console.error(`[generator] ✗ ${channel} — ${error}`);
    return { channel, content: "", status: "failed", error, generatedAt };
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate a full social-content pack for `article` using the prompt templates
 * in `promptsDir`.  All 5 channels run in parallel; a single channel failure
 * never aborts the others.
 */
export async function generatePack(
  article: ParsedArticle,
  promptsDir: string,
): Promise<GeneratedPack> {
  // Load and fill all 5 prompt templates
  const channelJobs: Array<{ channel: ChannelName; prompt: string }> = [];

  for (const fileName of CHANNEL_FILES) {
    const channel = FILE_TO_CHANNEL[fileName];
    const templatePath = path.join(promptsDir, fileName);
    const rawTemplate = await fs.readFile(templatePath, "utf-8");
    const prompt = fillTemplate(rawTemplate, article);
    channelJobs.push({ channel, prompt });
  }

  // Run all channels in parallel, tolerating individual failures
  const settled = await Promise.allSettled(
    channelJobs.map(({ channel, prompt }) => generateChannel(channel, prompt)),
  );

  // Build the channels record — fulfilled promises give ChannelResult directly;
  // rejected promises (shouldn't happen since generateChannel catches internally,
  // but be defensive) become failed results.
  const channels = {} as Record<ChannelName, ChannelResult>;

  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const channel = channelJobs[i].channel;
    if (s.status === "fulfilled") {
      channels[channel] = s.value;
    } else {
      const error =
        s.reason instanceof Error ? s.reason.message : String(s.reason);
      console.error(`[generator] ✗ ${channel} (unexpected rejection) — ${error}`);
      channels[channel] = {
        channel,
        content: "",
        status: "failed",
        error,
        generatedAt: new Date().toISOString(),
      };
    }
  }

  return {
    articleSlug: article.slug,
    articleTitle: article.title,
    articleUrl: article.canonicalUrl,
    generatedAt: new Date().toISOString(),
    channels,
  };
}
