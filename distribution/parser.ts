import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";

export interface ArticleFrontmatter {
  page_id: string;
  title: string;
  summary: string;
  content_type: "cancer_type" | "symptom" | "find_care";
  locale: string;
  audience: string[];
}

export interface ParsedArticle {
  slug: string;
  title: string;
  summary: string;
  contentType: "cancer_type" | "symptom" | "find_care";
  canonicalUrl: string;
  body: string;
  // Key sections extracted for prompt context
  warningSigns: string;
  nextSteps: string;
  diagnosticTests: string;
}

export async function parseArticle(filePath: string, canonicalUrl: string): Promise<ParsedArticle> {
  const raw = await fs.readFile(filePath, "utf-8");

  // Split frontmatter from body
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error(`No frontmatter found in ${path.basename(filePath)}`);
  }

  const fm = yaml.load(fmMatch[1]) as ArticleFrontmatter;
  const body = fmMatch[2].trim();

  if (!fm.page_id || !fm.title || !fm.content_type) {
    throw new Error(`Missing required frontmatter fields in ${path.basename(filePath)}`);
  }

  // Extract key sections from body for focused prompting
  const warningSigns = extractSection(body, [
    "warning sign", "warning signs", "signs and symptoms", "symptoms", "when to see"
  ]);
  const nextSteps = extractSection(body, [
    "what to do", "next steps", "when to seek", "see a doctor", "consult"
  ]);
  const diagnosticTests = extractSection(body, [
    "diagnos", "diagnostic", "tests", "screening"
  ]);

  return {
    slug: fm.page_id,
    title: fm.title,
    summary: fm.summary || "",
    contentType: fm.content_type,
    canonicalUrl,
    body,
    warningSigns,
    nextSteps,
    diagnosticTests,
  };
}

// Extract the first section whose heading matches any of the given keywords (case-insensitive)
function extractSection(body: string, keywords: string[]): string {
  const lines = body.split("\n");
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("#")) {
      const heading = line.replace(/^#+\s*/, "").toLowerCase();
      const matches = keywords.some((kw) => heading.includes(kw));
      if (matches) {
        inSection = true;
        sectionLines.push(line);
        continue;
      }
      // New heading ends the current section
      if (inSection) break;
    }
    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join("\n").trim();
}
