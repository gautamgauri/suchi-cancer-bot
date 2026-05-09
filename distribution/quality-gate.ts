/**
 * Editorial Quality Gate
 *
 * Channels that score below EDITORIAL_THRESHOLD (75/100) against Suchi
 * Editorial Principles are regenerated with targeted feedback.
 * Up to MAX_RETRIES attempts per channel before the pack is sent anyway
 * (with failing channels flagged in the console).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ChannelName, ChannelResult, GeneratedPack, fillTemplate, generateChannel } from "./generator";
import { ChannelEditorialResult, EditorialReport, scoreEditorial } from "./editorial-scorer";
import { ParsedArticle } from "./parser";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const EDITORIAL_THRESHOLD = 75;
const MAX_RETRIES = 2;

const CHANNEL_PROMPT_FILE: Record<ChannelName, string> = {
  linkedin:      "linkedin.md",
  twitter:       "twitter.md",
  instagram:     "instagram.md",
  whatsapp:      "whatsapp.md",
  youtube_short: "youtube-short.md",
};

// ---------------------------------------------------------------------------
// Feedback prompt builder
// ---------------------------------------------------------------------------

function buildFeedbackGuidance(result: ChannelEditorialResult): string {
  const lines: string[] = [];
  const { dimensions } = result;

  if (dimensions.humanFirst.score < 15) {
    lines.push(
      "❌ Human-First (" + dimensions.humanFirst.score + "/20): The opener reads like a disease definition.",
      "   Fix: Start with a specific human observation or scenario.",
      '   Example: "Many people ignore mouth sores for weeks, assuming they will heal on their own. Sometimes, they don\'t."',
    );
  }

  if (dimensions.indiaGrounded.score < 15) {
    lines.push(
      "❌ India-Grounded (" + dimensions.indiaGrounded.score + "/20): Missing local context.",
      "   Fix: Name specific local tobacco products (gutka, paan masala, khaini, bidi). Mention Bihar or Eastern India.",
      "   If space allows, reference PM-JAY / Ayushman Bharat for cost coverage.",
    );
  }

  if (dimensions.practical.score < 15) {
    lines.push(
      "❌ Practical (" + dimensions.practical.score + "/20): Missing specific guidance.",
      '   Fix: Include a specific timeframe ("if it persists for 2–3 weeks"), and a concrete action.',
      "   Where relevant, mention PM-JAY / Ayushman Bharat for treatment cost coverage.",
    );
  }

  if (dimensions.calmUrgency.score < 15) {
    lines.push(
      "❌ Calm Urgency (" + dimensions.calmUrgency.score + "/20): Missing calming hedges or action guidance.",
      '   Fix: Add a phrase like "these symptoms may have other causes" or "likely nothing serious, but worth checking".',
      "   Every alarming fact must be paired with a calm, concrete action step.",
    );
  }

  if (dimensions.clinicallyHumble.score < 15) {
    lines.push(
      "❌ Clinically Humble (" + dimensions.clinicallyHumble.score + "/20): Too certain or too clinical.",
      '   Fix: Use uncertainty language — "may", "could", "often", "sometimes", "in some cases".',
      "   Avoid implying a diagnosis.",
    );
  }

  return lines.join("\n");
}

function buildFeedbackPrompt(
  originalPrompt: string,
  previousContent: string,
  editorialResult: ChannelEditorialResult,
): string {
  const guidance = buildFeedbackGuidance(editorialResult);

  return `IMPROVEMENT REQUIRED
This content scored ${editorialResult.totalScore}/100 against Suchi Editorial Principles (threshold: ${EDITORIAL_THRESHOLD}/100).

What to fix:
${guidance}

Keep everything that is working. Improve only the flagged dimensions above.

CURRENT VERSION (improve this):
---
${previousContent}
---

ORIGINAL CHANNEL INSTRUCTIONS:
${originalPrompt}`;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GateResult {
  pack: GeneratedPack;
  editorialReport: EditorialReport;
  retriesDone: Partial<Record<ChannelName, number>>;
  allPassed: boolean;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function applyEditorialGate(
  pack: GeneratedPack,
  initialEditorialReport: EditorialReport,
  article: ParsedArticle,
  promptsDir: string,
): Promise<GateResult> {
  let currentPack = { ...pack, channels: { ...pack.channels } };
  let currentEditorial = initialEditorialReport;
  const retriesDone: Partial<Record<ChannelName, number>> = {};

  const allChannels: ChannelName[] = [
    "linkedin", "twitter", "instagram", "whatsapp", "youtube_short",
  ];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const failing = allChannels.filter((ch) => {
      const r = currentEditorial.channels[ch];
      return r && r.totalScore < EDITORIAL_THRESHOLD;
    });

    if (failing.length === 0) break;

    console.log(
      `\n[quality-gate] Attempt ${attempt}/${MAX_RETRIES} — ` +
      `${failing.length} channel(s) below ${EDITORIAL_THRESHOLD}: ${failing.join(", ")}`,
    );

    // Load base prompts for failing channels
    const retryJobs = await Promise.all(
      failing.map(async (channel) => {
        const templatePath = path.join(promptsDir, CHANNEL_PROMPT_FILE[channel]);
        const rawTemplate = await fs.readFile(templatePath, "utf-8");
        const basePrompt = fillTemplate(rawTemplate, article);
        const previousContent = currentPack.channels[channel].content;
        const editorialResult = currentEditorial.channels[channel];
        const feedbackPrompt = buildFeedbackPrompt(basePrompt, previousContent, editorialResult);
        return { channel, feedbackPrompt };
      }),
    );

    // Regenerate failing channels in parallel
    const results = await Promise.allSettled(
      retryJobs.map(({ channel, feedbackPrompt }) =>
        generateChannel(channel, feedbackPrompt),
      ),
    );

    // Splice improved results into pack
    for (let i = 0; i < results.length; i++) {
      const channel = retryJobs[i].channel;
      const s = results[i];
      if (s.status === "fulfilled" && s.value.status === "ok") {
        currentPack = {
          ...currentPack,
          channels: { ...currentPack.channels, [channel]: s.value },
        };
        retriesDone[channel] = (retriesDone[channel] ?? 0) + 1;
        console.log(`[quality-gate] ✓ regenerated ${channel}`);
      } else {
        const err = s.status === "rejected" ? s.reason : (s.value as ChannelResult).error;
        console.error(`[quality-gate] ✗ ${channel} regeneration failed — ${err}`);
      }
    }

    // Re-score
    currentEditorial = scoreEditorial(currentPack);
  }

  const allPassed = allChannels.every((ch) => {
    const r = currentEditorial.channels[ch];
    return !r || r.totalScore >= EDITORIAL_THRESHOLD;
  });

  if (!allPassed) {
    const stillFailing = allChannels
      .filter((ch) => {
        const r = currentEditorial.channels[ch];
        return r && r.totalScore < EDITORIAL_THRESHOLD;
      })
      .map((ch) => `${ch} (${currentEditorial.channels[ch].totalScore}/100)`);
    console.warn(
      `[quality-gate] ⚠ ${stillFailing.length} channel(s) still below threshold after ${MAX_RETRIES} retries: ${stillFailing.join(", ")}`,
    );
    console.warn("[quality-gate] Sending for human review anyway — reviewer will see scores.");
  }

  return { pack: currentPack, editorialReport: currentEditorial, retriesDone, allPassed };
}
