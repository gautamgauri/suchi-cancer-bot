/**
 * Targeted script: Search Gautam's Gmail for Cambridge-era documents (2014-2017).
 * SOPs, essays, reference letters, resumes, personal statements — mostly attachments.
 *
 * These are ~10 years old so Gmail search with date range ensures we reach them.
 *
 * Usage:
 *   export DATABASE_URL="postgresql://funding_user:...@localhost:5433/funding_db"
 *   export FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON='...'
 *   export FUNDING_GMAIL_USER="gautamgauri@dikshafoundation.org"
 *
 *   npx ts-node src/scripts/ingest-cambridge-gmail.ts [--dry-run]
 */
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";
import { JWT } from "google-auth-library";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;

const ORG_ID = "gautam";
const CORPUS = "personal";
const SOURCE_FOLDER = "personal_cambridge";
const QUALITY_TIER = "A";
const QUALITY_SCORE = 95; // High quality — personal primary sources
const MIN_TEXT_LENGTH = 50;
const DRY_RUN = process.argv.includes("--dry-run");

// Focused Cambridge-era queries — high-value personal documents only
const SEARCH_QUERIES = [
  // Cambridge application essays and SOPs
  'from:me has:attachment ("Cambridge App" OR "PhD Research Proposal" OR "personal statement" OR SOP) after:2015/01/01 before:2018/01/01',
  // Fellowship applications (Asha, Gates, etc.)
  'from:me has:attachment ("Fellowship application" OR "Asha Fellowship" OR "Gates" OR "fellowship") after:2015/01/01 before:2018/01/01',
  // Reference letters and recommendations
  'has:attachment ("letter of recommendation" OR "reference letter" OR "Reco GG") after:2014/01/01 before:2018/01/01',
  // Resumes and CVs — specifically Gautam's
  'from:me has:attachment ("Gautam Resume" OR "Gautam CV" OR "Gautam.docx") after:2014/01/01 before:2018/01/01',
  // Thesis and academic writing
  'from:me has:attachment (thesis OR "literature review" OR "methodology chapter") after:2015/01/01 before:2018/01/01',
  // PhD enquiry and research proposals
  'from:me has:attachment ("PhD Enquiry" OR "Research Proposal" OR "PhD Proposal") after:2015/01/01 before:2018/01/01',
  // Cover letters
  'from:me has:attachment ("cover letter") after:2014/01/01 before:2018/01/01',
  // Diksha concept notes and proposals (your writing)
  'from:me has:attachment ("concept note" OR "Diksha Proposal" OR "IGNITE Proposal" OR "Wipro Proposal") after:2014/01/01 before:2018/01/01',
  // Chevening / Commonwealth scholarship SOPs and applications
  'from:me has:attachment ("Chevening" OR "Commonwealth" OR "SOP") after:2013/01/01 before:2018/01/01',
  'from:me has:attachment ("personal statement" OR "statement of purpose") after:2013/01/01 before:2018/01/01',
  // Scholarship application emails (body text, not just attachments)
  'from:me ("Chevening" OR "Commonwealth" OR "scholarship application") after:2014/01/01 before:2018/01/01',
];

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

interface MimePart {
  mimeType?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: MimePart[];
  headers?: Array<{ name: string; value: string }>;
  filename?: string;
}

function extractBodyAndAttachments(payload: MimePart): {
  bodyParts: string[];
  attachments: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }>;
} {
  const bodyParts: string[] = [];
  const attachments: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> = [];

  function walk(part: MimePart): void {
    const mime = part.mimeType ?? "";
    const fn = part.filename || part.headers?.find((h) => h.name.toLowerCase() === "content-disposition")?.value?.match(/filename="?([^";\n]+)"?/)?.[1];

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
      for (const child of part.parts) walk(child);
    }
  }

  walk(payload);
  return { bodyParts, attachments };
}

function sanitizeText(text: string): string {
  // Remove null bytes that cause PostgreSQL UTF-8 errors
  return text.replace(/\0/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
}

async function main() {
  console.log(`Cambridge-Era Gmail Ingest — orgId: "${ORG_ID}", dry-run: ${DRY_RUN}`);

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
    // Collect unique message IDs
    const messageIds = new Set<string>();
    for (const q of SEARCH_QUERIES) {
      console.log(`\nSearching: ${q.slice(0, 100)}...`);
      try {
        let pageToken: string | undefined;
        let total = 0;
        do {
          const res = await gmail.users.messages.list({
            userId: "me",
            q,
            maxResults: 100, // Higher limit for older emails
            pageToken,
          });
          const msgs = res.data.messages ?? [];
          total += msgs.length;
          for (const m of msgs) {
            if (m.id) messageIds.add(m.id);
          }
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
        console.log(`  Found ${total} messages`);
      } catch (err) {
        console.warn(`  Search failed: ${(err as Error).message}`);
      }
    }

    console.log(`\nTotal unique Cambridge-era messages: ${messageIds.size}`);

    let created = 0;
    let attachmentsCreated = 0;
    let skipped = 0;
    let failed = 0;

    for (const msgId of messageIds) {
      try {
        // Check idempotency
        const existing = await prisma.evidenceDocument.findFirst({
          where: { driveFileId: { startsWith: `gmail::${msgId}::` } },
        });
        if (existing) {
          skipped++;
          continue;
        }

        const msgRes = await gmail.users.messages.get({
          userId: "me",
          id: msgId,
          format: "full",
        });
        const msg = msgRes.data;
        const headers = msg.payload?.headers ?? [];
        const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "(no subject)";
        const from = headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
        const dateStr = headers.find((h) => h.name?.toLowerCase() === "date")?.value;
        const emailDate = dateStr ? new Date(dateStr) : new Date();

        const { bodyParts, attachments } = extractBodyAndAttachments(msg.payload as MimePart);
        const bodyText = sanitizeText(bodyParts.join("\n\n").trim());

        console.log(`\n[${emailDate.toISOString().slice(0,10)}] "${subject.slice(0, 80)}" (${bodyText.length}ch, ${attachments.length} att)`);

        if (DRY_RUN) {
          for (const att of attachments) {
            console.log(`  ATT: ${att.filename} (${att.mimeType})`);
          }
          created++;
          continue;
        }

        // Ingest body if substantial
        if (bodyText.length >= 500) {
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
                source: "personal_cambridge_gmail",
                messageId: msgId,
                subject,
                from,
                era: "cambridge",
              },
            },
          });
          created++;
        }

        // Process attachments (focus on PDFs and docs — skip images)
        for (const att of attachments) {
          const attDriveFileId = `gmail::${msgId}::${att.attachmentId}`;
          const isPdf = att.mimeType === "application/pdf";
          const isDoc = att.mimeType.includes("document") || att.mimeType.includes("msword");
          const isText = att.mimeType.startsWith("text/");

          if (!isPdf && !isDoc && !isText) {
            console.log(`  Skip: ${att.filename} (${att.mimeType})`);
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
              attText = sanitizeText((parsed.text || "").trim());
            } else {
              attText = sanitizeText(buffer.toString("utf-8").trim());
            }

            if (attText.length < MIN_TEXT_LENGTH) {
              console.log(`  Too short: ${att.filename} (${attText.length}ch)`);
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
                name: `${att.filename} (${emailDate.toISOString().slice(0,10)}: ${subject.slice(0, 80)})`,
                mimeType: att.mimeType,
                createdTime: emailDate,
                modifiedTime: emailDate,
                downloadStatus: "success",
                rawText: attText,
                cleanText: attText,
                extractionStatus: "success",
                extractionMeta: {
                  source: "personal_cambridge_gmail",
                  messageId: msgId,
                  attachmentFilename: att.filename,
                  subject,
                  era: "cambridge",
                },
              },
            });
            attachmentsCreated++;
            console.log(`  + ${att.filename} (${attText.length}ch)`);
          } catch (attErr) {
            console.warn(`  ERR ${att.filename}: ${(attErr as Error).message.slice(0, 100)}`);
          }
        }
      } catch (err) {
        failed++;
        console.warn(`  Failed ${msgId}: ${(err as Error).message.slice(0, 100)}`);
      }
    }

    console.log(`\n=== Cambridge-Era Ingest Summary ===`);
    console.log(`Email bodies: ${created}`);
    console.log(`Attachments: ${attachmentsCreated}`);
    console.log(`Skipped (already indexed): ${skipped}`);
    console.log(`Failed: ${failed}`);
    console.log(`\nTotal new docs: ${created + attachmentsCreated}`);
    console.log(`\nNext: chunk + embed via API or local script`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
