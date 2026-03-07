import type { RetrievalChunkDto } from "../../evidence_ingest/retrieval.service";
import { GAUTAM_VOICE_GUIDE } from "./voice-guide";

/**
 * Section archetypes — each fellowship section has a unique purpose.
 * Keyed by normalized section name patterns (substring match).
 */
export const FELLOWSHIP_SECTION_ARCHETYPES: Record<string, {
  owns: string;
  avoids: string;
  voiceNote: string;
}> = {
  "engagement": {
    owns: "Intellectual journey: what you've read, your views, original thinking about the field",
    avoids: "Career plans, founding story, project descriptions (those belong in other sections)",
    voiceNote: "Reflective, scholarly. Show depth of reading and independent thought.",
  },
  "career": {
    owns: "Current direction, uncertainties, how the fellowship accelerates the journey",
    avoids: "Detailed engagement with the field (covered in Engagement). Don't restate founding story.",
    voiceNote: "Forward-looking, honest about uncertainties.",
  },
  "motivation": {
    owns: "Personal origin story — why you do this work, the formative experience",
    avoids: "Technical project details, career plans, research agenda",
    voiceNote: "Emotional, specific. Name the moment that changed you.",
  },
  "leadership": {
    owns: "Concrete leadership examples — decisions made, team built, challenges navigated",
    avoids: "Origin story (that's Motivation). Research agenda (that's Research Plan).",
    voiceNote: "Show-don't-tell. Name specific people, decisions, outcomes.",
  },
  "research": {
    owns: "What you want to LEARN, the question you're investigating, concrete deliverable",
    avoids: "Past achievements (that's Track Record). Founding story (that's Motivation).",
    voiceNote: "Intellectually curious. Reference frameworks, cite gaps in knowledge.",
  },
  "contribution": {
    owns: "What you bring TO the fellowship community — skills, perspectives, collaborations",
    avoids: "What you want FROM the fellowship (that's Career Plans). Past projects in detail.",
    voiceNote: "Generous, peer-oriented. Focus on what you give, not what you get.",
  },
};

/**
 * Fuzzy-match a section name to an archetype via substring includes.
 */
export function matchArchetype(sectionName: string): {
  owns: string;
  avoids: string;
  voiceNote: string;
} | undefined {
  const lower = sectionName.toLowerCase();
  for (const [key, archetype] of Object.entries(FELLOWSHIP_SECTION_ARCHETYPES)) {
    if (lower.includes(key)) {
      return archetype;
    }
  }
  return undefined;
}

/**
 * Minimal system prompt — no org framing, so first-person is the only natural voice.
 * ~50 tokens. The LLM follows context, not instructions.
 */
export const FELLOWSHIP_SYSTEM_PROMPT = `You are continuing Gautam Gauri's writing for a fellowship application.
Write as Gautam — first person singular throughout ("I", "my", "me").
Voice: reflective, specific, honest about challenges, forward-looking.
Cite evidence as [citation:docId:chunkId].
Never use "we", "our", "the organization", or third-person references to Diksha Foundation as subject.
Each section has a unique purpose. Never repeat the same anecdote, statistic, or founding story across sections.
This is a fully funded fellowship. Never include budget breakdowns, INR amounts, or fund allocation language.
If a word limit is given, write to exactly that length. Front-load the most compelling content.

${GAUTAM_VOICE_GUIDE}`;

/**
 * Build the user prompt for a fellowship section.
 * Order matters — past answers first to prime the voice.
 */
export function buildFellowshipUserPrompt(params: {
  pastAnswers: string;
  applicantProfile: string;
  chunks: RetrievalChunkDto[];
  sectionName: string;
  sectionGuidance: string;
  wordLimit?: number;
  fellowshipName: string;
  archetype?: { owns: string; avoids: string; voiceNote: string };
  previousSectionsSummary?: string;
}): string {
  const parts: string[] = [];

  // 1. Past approved answers — primes the first-person voice
  if (params.pastAnswers && params.pastAnswers !== "(No past answers available yet.)") {
    parts.push(`=== PAST APPROVED ANSWERS (use this voice and style) ===
${params.pastAnswers}
=== END PAST ANSWERS ===`);
  }

  // 2. Applicant profile
  parts.push(`=== APPLICANT PROFILE ===
${params.applicantProfile}
=== END PROFILE ===`);

  // 3. Retrieved personal evidence with citation tokens
  if (params.chunks.length > 0) {
    const chunksList = params.chunks
      .map((chunk, idx) => {
        const citation = `[citation:${chunk.source}:${chunk.id}]`;
        const content = chunk.text.substring(0, 2000) + (chunk.text.length > 2000 ? "..." : "");
        return `---
CHUNK ${idx + 1}: ${chunk.title || chunk.source}
CITATION TOKEN: ${citation}
CONTENT: ${content}
---`;
      })
      .join("\n\n");

    parts.push(`=== PERSONAL EVIDENCE ===
${chunksList}
=== END EVIDENCE ===`);
  } else {
    parts.push(`=== NO RETRIEVAL EVIDENCE AVAILABLE ===
You have no retrieved evidence chunks. Write entirely from the Applicant Profile and reusable snippets above.
Draw on specific anecdotes, names, dates, numbers, and projects from the profile.
Target ${params.wordLimit ?? 300} words. Do NOT produce thin generic output.
Every section must contain at least one specific personal detail (a named project, a number, a date, a place).
=== END ===`);
  }

  // 4. Section archetype (when available)
  if (params.archetype) {
    parts.push(`=== SECTION ARCHETYPE ===
THIS SECTION OWNS: ${params.archetype.owns}
DO NOT REPEAT FROM OTHER SECTIONS: ${params.archetype.avoids}
VOICE NOTE: ${params.archetype.voiceNote}
=== END ARCHETYPE ===`);
  }

  // 5. Cross-section dedup context
  if (params.previousSectionsSummary) {
    parts.push(`=== ALREADY COVERED IN OTHER SECTIONS ===
${params.previousSectionsSummary}
Do NOT repeat these points. Reference them briefly if needed.
=== END ===`);
  }

  // 6. Section question + guidance
  parts.push(`=== SECTION TO WRITE ===
Fellowship: ${params.fellowshipName}
Section: ${params.sectionName}
Guidance: ${params.sectionGuidance}
${params.wordLimit ? `Word limit: ${params.wordLimit} words` : ""}

Write this section as Gautam Gauri in first person singular. Draw on the personal evidence and profile above.
Every factual claim should reference a citation token from the evidence chunks.
Use {{MISSING: description}} only for data you truly cannot find in the provided context.
=== END SECTION ===`);

  return parts.join("\n\n");
}
