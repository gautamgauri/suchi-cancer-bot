import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FundingLlmService } from "../core_ai/funding-llm.service";
import * as cheerio from "cheerio";
import {
  ApplicationDocument,
  ApplicationStatus,
  ApplicationTriage,
  OppAddRequest,
} from "./application.types";
import {
  TRIAGE_SYSTEM_PROMPT,
  buildTriageContext,
} from "./prompts/application.prompts";

@Injectable()
export class ApplicationIntakeService {
  private readonly logger = new Logger(ApplicationIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: FundingLlmService,
  ) {}

  /**
   * Ingest a new opportunity from a URL. Fetches the page, extracts metadata,
   * and creates a PersonalApplication record.
   */
  async ingest(req: OppAddRequest): Promise<{ applicationId: string; programName: string }> {
    const { url, notes, owner } = req;
    this.logger.log(`Ingesting opportunity from URL: ${url}`);

    // Fetch page content
    const pageContent = await this.fetchPageContent(url);

    // Use LLM to extract basic metadata
    const metadata = await this.extractMetadata(url, pageContent);

    // Generate application ID
    const applicationId = this.generateApplicationId(metadata.programName, metadata.opportunityType);

    const now = new Date().toISOString();
    const doc: ApplicationDocument = {
      schemaVersion: "1.0",
      applicationId,
      sourceUrl: url,
      programName: metadata.programName,
      organizerName: metadata.organizerName,
      opportunityType: metadata.opportunityType,
      deadline: metadata.deadline,
      status: "intake" as ApplicationStatus,
      questions: [],
      answers: [],
      owner: owner ?? "gautam",
      timeline: [
        {
          timestamp: now,
          action: "intake",
          actor: owner ?? "gautam",
          details: `Ingested from ${url}`,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    // Store in DB
    await this.prisma.personalApplication.create({
      data: {
        applicationId,
        sourceUrl: url,
        programName: metadata.programName,
        organizerName: metadata.organizerName,
        opportunityType: metadata.opportunityType,
        deadline: metadata.deadline ? new Date(metadata.deadline) : null,
        status: "intake",
        owner: owner ?? "gautam",
        jsonBlob: doc as unknown as Record<string, unknown>,
        notes: notes ?? null,
      },
    });

    // Log audit event
    await this.prisma.applicationAuditEvent.create({
      data: {
        applicationId: (await this.prisma.personalApplication.findUnique({
          where: { applicationId },
          select: { id: true },
        }))!.id,
        action: "intake",
        status: "success",
        actor: owner ?? "gautam",
        details: { url, notes } as unknown as Record<string, unknown>,
      },
    });

    this.logger.log(`Ingested application: ${applicationId} — ${metadata.programName}`);
    return { applicationId, programName: metadata.programName };
  }

  /**
   * Run triage on an existing application.
   */
  async triage(applicationId: string): Promise<ApplicationTriage> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId },
    });
    if (!app) throw new Error(`Application not found: ${applicationId}`);

    const pageContent = await this.fetchPageContent(app.sourceUrl);
    const context = buildTriageContext(pageContent, app.sourceUrl);

    const raw = await this.llm.generatePlain(
      TRIAGE_SYSTEM_PROMPT,
      context,
      "Assess this opportunity for fit, effort, and recommendation.",
    );

    let triage: ApplicationTriage;
    try {
      triage = JSON.parse(raw);
    } catch {
      this.logger.warn(`Failed to parse triage JSON for ${applicationId}, using fallback`);
      triage = {
        fitLevel: "unknown",
        fitReasons: ["Could not parse triage response"],
        effortLevel: "medium",
        estimatedQuestions: 0,
        deadline: null,
        relevanceThemes: [],
        recommendation: "Manual triage recommended — LLM response could not be parsed.",
      };
    }

    // Update the application record
    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    jsonBlob.triage = triage;
    jsonBlob.status = "triaged";
    (jsonBlob.timeline as Array<Record<string, unknown>>).push({
      timestamp: new Date().toISOString(),
      action: "triage",
      actor: "system",
      details: `Fit: ${triage.fitLevel}, Effort: ${triage.effortLevel}`,
    });
    jsonBlob.updatedAt = new Date().toISOString();

    await this.prisma.personalApplication.update({
      where: { applicationId },
      data: {
        status: "triaged",
        deadline: triage.deadline ? new Date(triage.deadline) : app.deadline,
        jsonBlob: jsonBlob as unknown as Record<string, unknown>,
      },
    });

    await this.prisma.applicationAuditEvent.create({
      data: {
        applicationId: app.id,
        action: "triage",
        status: "success",
        actor: "system",
        details: triage as unknown as Record<string, unknown>,
      },
    });

    return triage;
  }

  /**
   * Fetch and extract text content from a URL using cheerio.
   */
  async fetchPageContent(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; DikshaBotApplicationAssistant/1.0)",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        this.logger.warn(`Failed to fetch ${url}: ${response.status}`);
        return `[Failed to fetch page: HTTP ${response.status}]`;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove scripts, styles, nav, footer
      $("script, style, nav, footer, header, .cookie-banner, .newsletter-signup").remove();

      // Extract form fields specifically
      const formFields: string[] = [];
      $("form").each((_i, form) => {
        $(form).find("label, input, textarea, select").each((_j, el) => {
          const tag = $(el).prop("tagName")?.toLowerCase();
          if (tag === "label") {
            formFields.push(`[LABEL] ${$(el).text().trim()}`);
          } else if (tag === "input") {
            const type = $(el).attr("type") ?? "text";
            const name = $(el).attr("name") ?? "";
            const placeholder = $(el).attr("placeholder") ?? "";
            const required = $(el).attr("required") !== undefined;
            formFields.push(`[INPUT type=${type} name=${name} placeholder="${placeholder}" required=${required}]`);
          } else if (tag === "textarea") {
            const name = $(el).attr("name") ?? "";
            const maxlength = $(el).attr("maxlength") ?? "";
            formFields.push(`[TEXTAREA name=${name} maxlength=${maxlength}]`);
          } else if (tag === "select") {
            const name = $(el).attr("name") ?? "";
            const options = $(el).find("option").map((_k, opt) => $(opt).text().trim()).get();
            formFields.push(`[SELECT name=${name} options=[${options.join(", ")}]]`);
          }
        });
      });

      // Get page text
      const bodyText = $("body").text().replace(/\s+/g, " ").trim();
      const title = $("title").text().trim();

      let result = `PAGE TITLE: ${title}\n\n`;
      if (formFields.length > 0) {
        result += `FORM FIELDS DETECTED:\n${formFields.join("\n")}\n\n`;
      }
      result += `PAGE TEXT:\n${bodyText.substring(0, 10000)}`;

      return result;
    } catch (error) {
      const msg = (error as Error)?.message ?? "Unknown error";
      this.logger.warn(`Error fetching ${url}: ${msg}`);
      return `[Error fetching page: ${msg}]`;
    }
  }

  /**
   * Use LLM to extract basic metadata from the page content.
   */
  private async extractMetadata(url: string, pageContent: string): Promise<{
    programName: string;
    organizerName: string;
    opportunityType: "fellowship" | "accelerator" | "conference" | "award" | "grant" | "other";
    deadline: string | null;
  }> {
    const systemPrompt = `Extract basic metadata from this opportunity page. Respond with valid JSON only:
{
  "programName": "<name of the program/fellowship/accelerator>",
  "organizerName": "<organizing body>",
  "opportunityType": "fellowship" | "accelerator" | "conference" | "award" | "grant" | "other",
  "deadline": "<ISO date string or null>"
}`;

    const raw = await this.llm.generatePlain(
      systemPrompt,
      `URL: ${url}\n\n${pageContent.substring(0, 4000)}`,
      "Extract the metadata.",
    );

    try {
      const parsed = JSON.parse(raw);
      return {
        programName: typeof parsed.programName === "string" ? parsed.programName : "Unknown Program",
        organizerName: typeof parsed.organizerName === "string" ? parsed.organizerName : "",
        opportunityType: parsed.opportunityType ?? "other",
        deadline: typeof parsed.deadline === "string" ? parsed.deadline : null,
      };
    } catch {
      this.logger.warn("Failed to parse metadata JSON, using fallback");
      return {
        programName: "Unknown Program",
        organizerName: "",
        opportunityType: "other",
        deadline: null,
      };
    }
  }

  /**
   * Generate a deterministic application ID.
   */
  private generateApplicationId(programName: string, type: string): string {
    const year = new Date().getFullYear();
    const slug = programName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .substring(0, 30)
      .replace(/-+$/, "");
    const random = Math.random().toString(36).substring(2, 6);
    return `APP-${year}-${type}-${slug}-${random}`;
  }
}
