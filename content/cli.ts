/**
 * Suchi Content Pipeline CLI
 *
 * Commands:
 *   add <slug> <content-type> <draft-file-path>  — upload draft to GCS, add to queue
 *   send <slug>                                   — send review email to Divya + Gautam
 *   status                                        — print queue table
 *   publish                                       — write all approved drafts to articles/
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadQueue, saveQueue, uploadDraft, downloadDraft } from "./queue-manager";
import { sendArticleReviewEmail } from "./article-mailer";
import { ArticleEntry } from "./types";

const QUEUE_PATH = path.resolve(__dirname, "queue.json");
const ARTICLES_DIR = path.resolve(__dirname, "../apps/landing/src/content/articles");

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

async function cmdAdd(slug: string, contentType: string, draftFilePath: string): Promise<void> {
  const absPath = path.isAbsolute(draftFilePath) ? draftFilePath : path.resolve(process.cwd(), draftFilePath);
  const markdown = await fs.readFile(absPath, "utf-8").catch(() => {
    console.error(`Error: could not read "${absPath}"`);
    process.exit(1);
  });

  // Extract title from frontmatter
  const titleMatch = markdown.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  const title = titleMatch ? titleMatch[1] : slug;

  await uploadDraft(slug, markdown);
  console.log(`Uploaded draft to GCS: content-drafts/${slug}.md`);

  const articles = await loadQueue(QUEUE_PATH);
  const existing = articles.find((a) => a.slug === slug);

  if (existing) {
    existing.title = title;
    existing.contentType = contentType;
    existing.status = "draft";
    console.log(`Updated existing queue entry for "${slug}"`);
  } else {
    const entry: ArticleEntry = {
      slug,
      title,
      contentType,
      status: "draft",
      createdAt: new Date().toISOString(),
    };
    articles.push(entry);
    console.log(`Added new queue entry for "${slug}"`);
  }

  await saveQueue(QUEUE_PATH, articles);
  console.log(`\nNext step — send for review:\n  npx ts-node content/cli.ts send ${slug}`);
}

// ---------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------

async function cmdSend(slug: string): Promise<void> {
  const articles = await loadQueue(QUEUE_PATH);
  const entry = articles.find((a) => a.slug === slug);

  if (!entry) {
    console.error(`Error: "${slug}" not found in queue. Run "add" first.`);
    process.exit(1);
  }

  if (entry.status === "approved") {
    console.error(`Error: "${slug}" is already approved.`);
    process.exit(1);
  }

  if (entry.status === "email_sent") {
    console.warn(`Warning: "${slug}" was already sent — resending...`);
  }

  const markdown = await downloadDraft(slug);
  const result = await sendArticleReviewEmail(entry, markdown);

  entry.approvalToken = result.approvalToken;
  entry.status = "email_sent";
  entry.emailSentAt = new Date().toISOString();
  await saveQueue(QUEUE_PATH, articles);

  if (result.emailSent) {
    console.log(`\nReview email sent for "${slug}"`);
    console.log(`To: gautamgauri@dikshafoundation.org, divya.vats@dikshafoundation.org`);
    console.log(`Status → email_sent`);
  } else if (result.emailError) {
    console.error(`\nEmail failed: ${result.emailError}`);
    process.exit(1);
  } else {
    console.log(`\nSMTP not configured — email skipped. Status → email_sent (token saved)`);
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

async function cmdStatus(): Promise<void> {
  const articles = await loadQueue(QUEUE_PATH);

  if (articles.length === 0) {
    console.log("No articles in queue.");
    return;
  }

  const col = {
    slug: Math.max(4, ...articles.map((a) => a.slug.length)),
    type: Math.max(4, ...articles.map((a) => a.contentType.length)),
    status: Math.max(6, ...articles.map((a) => a.status.length)),
  };
  const pad = (s: string, n: number) => s.padEnd(n);
  const header = `${pad("SLUG", col.slug)}  ${pad("TYPE", col.type)}  ${pad("STATUS", col.status)}`;
  const divider = "-".repeat(header.length);

  console.log(divider);
  console.log(header);
  console.log(divider);
  for (const a of articles) {
    console.log(`${pad(a.slug, col.slug)}  ${pad(a.contentType, col.type)}  ${pad(a.status, col.status)}`);
  }
  console.log(divider);
  console.log(`Total: ${articles.length}`);
  const counts: Record<string, number> = {};
  for (const a of articles) counts[a.status] = (counts[a.status] ?? 0) + 1;
  for (const [s, c] of Object.entries(counts)) console.log(`  ${s}: ${c}`);
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

async function cmdPublish(): Promise<void> {
  const articles = await loadQueue(QUEUE_PATH);
  const approved = articles.filter((a) => a.status === "approved");

  if (approved.length === 0) {
    console.log("No approved articles to publish.");
    return;
  }

  await fs.mkdir(ARTICLES_DIR, { recursive: true });

  for (const entry of approved) {
    const markdown = await downloadDraft(entry.slug);
    const outPath = path.join(ARTICLES_DIR, `${entry.slug}.md`);
    await fs.writeFile(outPath, markdown, "utf-8");
    console.log(`Published: ${outPath}`);
  }

  console.log(`\n${approved.length} article(s) written to ${ARTICLES_DIR}`);
  console.log(`Next: commit and deploy the landing app.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (!command) {
    console.error("Suchi Content Pipeline CLI");
    console.error("");
    console.error("Usage:");
    console.error("  npx ts-node content/cli.ts add <slug> <content-type> <draft-file>");
    console.error("  npx ts-node content/cli.ts send <slug>");
    console.error("  npx ts-node content/cli.ts status");
    console.error("  npx ts-node content/cli.ts publish");
    process.exit(1);
  }

  switch (command) {
    case "add": {
      const [slug, contentType, filePath] = args;
      if (!slug || !contentType || !filePath) {
        console.error("Usage: add <slug> <content-type> <draft-file-path>");
        process.exit(1);
      }
      await cmdAdd(slug, contentType, filePath);
      break;
    }
    case "send": {
      const [slug] = args;
      if (!slug) { console.error("Usage: send <slug>"); process.exit(1); }
      await cmdSend(slug);
      break;
    }
    case "status":
      await cmdStatus();
      break;
    case "publish":
      await cmdPublish();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
