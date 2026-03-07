/**
 * Script: Search Gautam's Gmail for personal content (past applications,
 * CVs, bios, fellowship essays, personal statements) and ingest into
 * the evidence library with orgId="gautam".
 *
 * Uses Domain-Wide Delegation (same auth as funding bot Gmail Memory).
 *
 * Usage:
 *   # Set env vars (or export from .env)
 *   export DATABASE_URL="postgresql://funding_user:...@localhost:5433/funding_db"
 *   export FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON='{"client_email":"...","private_key":"..."}'
 *   export FUNDING_GMAIL_USER="gautamgauri@dikshafoundation.org"
 *
 *   npx ts-node src/scripts/ingest-personal-gmail.ts [--dry-run] [--limit N]
 */
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { JWT } from "google-auth-library";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;

const ORG_ID = "gautam";
const CORPUS = "personal";
const SOURCE_FOLDER = "personal_gmail";
const QUALITY_TIER = "A";
const QUALITY_SCORE = 90;
const MIN_TEXT_LENGTH = 80;

// Gmail search queries to find personal content
const SEARCH_QUERIES = [
  // Past fellowship / application drafts sent
  'from:me subject:(fellowship OR application OR "personal statement" OR accelerator OR scholarship)',
  // Cambridge-related
  'from:me (Cambridge OR "MPhil" OR "university of cambridge")',
  // Bios, CVs, resumes sent out
  'from:me has:attachment (CV OR resume OR bio OR "cover letter")',
  // Fellowship/accelerator communications received
  'to:me subject:(fellowship OR "you have been selected" OR "shortlisted" OR "application received")',
  // AI ethics / Digital Minds related (for Digital Minds fellowship)
  'from:me ("AI ethics" OR "digital minds" OR "AI welfare" OR "machine sentience" OR "AI consciousness")',
  // Personal reflections on work
  'from:me ("why I" OR "my journey" OR "my work" OR "my motivation" OR "my vision")',
  // Diksha/SCCF personal pitch emails
  'from:me ("Diksha Foundation" OR "SCCF" OR "suchitra") (proposal OR partnership OR collaboration)',
];

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.findIndex((a) => a === "--limit");
const MAX_EMAILS = LIMIT_ARG >= 0 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : 200;

interface ParsedAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n\n");
}

function extractBodyAndAttachments(
  payload: { mimeType?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: unknown[]; headers?: Array<{ name: string; value: string }> },
  filename?: string,
): { bodyParts: string[]; attachments: ParsedAttachment[] } {
  const bodyParts: string[] = [];
  const attachments: ParsedAttachment[] = [];

  function walk(part: typeof payload, parentFilename?: string): void {
    const mime = part.mimeType ?? "";
    const fn = parentFilename ?? part.headers?.find((h) => h.name.toLowerCase() === "content-disposition")?.value?.match(/filename="?([^";\n]+)"?/)?.[1];

    if (part.body?.attachmentId && fn) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: fn,
        mimeType: mime,
        size: part.body.size ?? 0,
      });
      return;
    }

    if (mime === "text/plain" && part.body?.data) {
      bodyParts.push(Buffer.from(part.body.data, "base64url").toString("utf-8"));
    } else if (mime === "text/html" && part.body?.data) {
      bodyParts.push(htmlToPlainText(Buffer.from(part.body.data, "base64url").toString("utf-8")));
    }

    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walk(child as typeof payload, fn);
      }
    }
  }

  walk(payload, filename);
  return { bodyParts, attachments };
}

async function main() {
  console.log(`Personal Gmail Ingest — orgId: "${ORG_ID}", dry-run: ${DRY_RUN}, max: ${MAX_EMAILS}`);

  // 1. Set up auth
  const saJson = process.env.FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON;
  const gmailUser = process.env.FUNDING_GMAIL_USER;
  if (!saJson || !gmailUser) {
    console.error("Missing FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON or FUNDING_GMAIL_USER");
    process.exit(1);
  }

  const creds = JSON.parse(saJson);
  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    subject: gmailUser,
  });

  const gmail = google.gmail({ version: "v1", auth });
  const prisma = new PrismaClient();

  try {
    // 2. Collect unique message IDs across all queries
    const messageIds = new Set<string>();
    for (const q of SEARCH_QUERIES) {
      console.log(`\nSearching: ${q.slice(0, 80)}...`);
      try {
        const res = await gmail.users.messages.list({
          userId: "me",
          q,
          maxResults: 50,
        });
        const msgs = res.data.messages ?? [];
        console.log(`  Found ${msgs.length} messages`);
        for (const m of msgs) {
          if (m.id) messageIds.add(m.id);
        }
      } catch (err) {
        console.warn(`  Search failed: ${(err as Error).message}`);
      }
    }

    console.log(`\nTotal unique messages: ${messageIds.size}`);
    const idsToProcess = Array.from(messageIds).slice(0, MAX_EMAILS);
    console.log(`Processing: ${idsToProcess.length} (limit: ${MAX_EMAILS})`);

    let created = 0;
    let skipped = 0;
    let attachmentsIngested = 0;
    let failed = 0;

    for (const msgId of idsToProcess) {
      try {
        // Check idempotency — skip if already ingested
        const existingBody = await prisma.evidenceDocument.findUnique({
          where: { driveFileId: `gmail::${msgId}::body` },
        });
        if (existingBody) {
          skipped++;
          continue;
        }

        // Fetch full message
        const msgRes = await gmail.users.messages.get({
          userId: "me",
          id: msgId,
          format: "full",
        });
        const msg = msgRes.data;
        const headers = msg.payload?.headers ?? [];
        const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "(no subject)";
        const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
        const to = headers.find((h) => h.name?.toLowerCase() === "to")?.value ?? "";
        const dateStr = headers.find((h) => h.name?.toLowerCase() === "date")?.value;
        const emailDate = dateStr ? new Date(dateStr) : new Date();

        // Extract body text + attachments
        const { bodyParts, attachments } = extractBodyAndAttachments(msg.payload as Parameters<typeof extractBodyAndAttachments>[0]);
        const bodyText = bodyParts.join("\n\n").trim();

        console.log(`\n[${msgId}] "${subject.slice(0, 90)}" (${bodyText.length} chars, ${attachments.length} att)`);

        // Deduplicate by subject — skip if we already ingested an email with the same subject
        // (avoids 20+ identical reminder emails)
        if (bodyText.length < 1000 && attachments.length === 0) {
          const subjectDupe = await prisma.evidenceDocument.findFirst({
            where: {
              orgId: ORG_ID,
              sourceFolder: SOURCE_FOLDER,
              name: { startsWith: `Email: ${subject.slice(0, 100)}` },
            },
          });
          if (subjectDupe) {
            console.log(`  Skipping duplicate subject`);
            skipped++;
            continue;
          }
        }

        if (DRY_RUN) {
          console.log(`  DRY-RUN: would create body doc + ${attachments.length} attachment docs`);
          created++;
          continue;
        }

        // 3a. Ingest email body as evidence document
        if (bodyText.length >= MIN_TEXT_LENGTH) {
          await prisma.evidenceDocument.create({
            data: {
              driveFileId: `gmail::${msgId}::body`,
              sourceFolder: SOURCE_FOLDER,
              corpus: CORPUS,
              orgId: ORG_ID,
              qualityTier: QUALITY_TIER,
              qualityScore: QUALITY_SCORE,
              name: `Email: ${subject.slice(0, 200)}`,
              mimeType: "text/plain",
              createdTime: emailDate,
              modifiedTime: emailDate,
              downloadStatus: "success",
              rawText: bodyText,
              cleanText: bodyText,
              extractionStatus: "success",
              extractionMeta: {
                source: "personal_gmail",
                messageId: msgId,
                subject,
                from,
                to,
              },
            },
          });
          created++;
        } else {
          console.log(`  Body too short (${bodyText.length} chars), skipping body`);
        }

        // 3b. Ingest PDF/DOCX attachments
        for (const att of attachments) {
          const attDriveFileId = `gmail::${msgId}::${att.attachmentId}`;
          const attExisting = await prisma.evidenceDocument.findUnique({
            where: { driveFileId: attDriveFileId },
          });
          if (attExisting) continue;

          const isPdf = att.mimeType === "application/pdf";
          const isText = att.mimeType.startsWith("text/");
          const isDoc = att.mimeType.includes("document") || att.mimeType.includes("msword");

          if (!isPdf && !isText && !isDoc) {
            console.log(`  Skipping attachment ${att.filename} (${att.mimeType})`);
            continue;
          }

          try {
            const attRes = await gmail.users.messages.attachments.get({
              userId: "me",
              messageId: msgId,
              id: att.attachmentId,
            });
            const buffer = Buffer.from(attRes.data.data ?? "", "base64url");

            let attText: string;
            if (isPdf) {
              const parsed = await pdfParse(buffer);
              attText = (parsed.text || "").trim();
            } else {
              attText = buffer.toString("utf-8").trim();
            }

            if (attText.length < MIN_TEXT_LENGTH) {
              console.log(`  Attachment ${att.filename} too short (${attText.length} chars)`);
              continue;
            }

            await prisma.evidenceDocument.create({
              data: {
                driveFileId: attDriveFileId,
                sourceFolder: SOURCE_FOLDER,
                corpus: CORPUS,
                orgId: ORG_ID,
                qualityTier: QUALITY_TIER,
                qualityScore: QUALITY_SCORE,
                name: `${att.filename} (from: ${subject.slice(0, 100)})`,
                mimeType: att.mimeType,
                createdTime: emailDate,
                modifiedTime: emailDate,
                downloadStatus: "success",
                rawText: attText,
                cleanText: attText,
                extractionStatus: "success",
                extractionMeta: {
                  source: "personal_gmail",
                  messageId: msgId,
                  attachmentFilename: att.filename,
                  subject,
                },
              },
            });
            attachmentsIngested++;
            console.log(`  + Attachment: ${att.filename} (${attText.length} chars)`);
          } catch (attErr) {
            console.warn(`  Failed to process attachment ${att.filename}: ${(attErr as Error).message}`);
          }
        }
      } catch (err) {
        failed++;
        console.warn(`  Failed to process ${msgId}: ${(err as Error).message}`);
      }
    }

    // 4. Also fix existing applicant-profile doc to use orgId="gautam"
    const profileDoc = await prisma.evidenceDocument.findUnique({
      where: { driveFileId: "manual::applicant-profile-gautam-gauri" },
    });
    if (profileDoc && profileDoc.orgId !== ORG_ID) {
      await prisma.evidenceDocument.update({
        where: { id: profileDoc.id },
        data: { orgId: ORG_ID, corpus: CORPUS },
      });
      console.log(`\nFixed applicant-profile orgId → "${ORG_ID}"`);
    }

    console.log(`\n=== Summary ===`);
    console.log(`Email bodies ingested: ${created}`);
    console.log(`Attachments ingested: ${attachmentsIngested}`);
    console.log(`Skipped (already indexed): ${skipped}`);
    console.log(`Failed: ${failed}`);
    console.log(`\nNext steps:`);
    console.log(`  1. POST /v1/evidence-ingest/chunk  (to chunk new docs)`);
    console.log(`  2. POST /v1/evidence-ingest/embed  (to embed chunks)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
