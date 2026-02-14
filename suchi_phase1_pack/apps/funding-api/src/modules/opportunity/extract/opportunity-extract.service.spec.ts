import type { ConfigService } from "@nestjs/config";
import { OpportunityExtractService } from "./opportunity-extract.service";
import { OpportunityIntelligenceService } from "./opportunity-intelligence.service";
import type { RfpTextExtractService } from "./rfp-text-extract.service";
import type { RfpConstraintsExtractService } from "./rfp-constraints-extract.service";
import type { AnnexureSchemaService } from "./annexure-schema.service";

describe("OpportunityExtractService", () => {
  const makeService = (text: string) => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === "FUNDING_ORG_NAME") return "Diksha Foundation";
        return undefined;
      }),
    } as unknown as ConfigService;

    const rfpText = {
      extractText: jest.fn(async () => text),
    } as unknown as RfpTextExtractService;

    const constraints = {
      extract: jest.fn(async () => ({
        funderName: "Acme Foundation",
        programName: "Youth Learning Grant",
        deadline: "2026-04-10T23:59:00+05:30",
        geography: ["India", "Bihar"],
        themes: { primary: ["Education"], secondary: ["Skills"] },
        maxGrantAmountINR: 3000000,
      })),
    } as unknown as RfpConstraintsExtractService;

    const annexure = {
      isSpreadsheet: jest.fn(() => false),
      parseSheetSchema: jest.fn(() => []),
    } as unknown as AnnexureSchemaService;

    return new OpportunityExtractService(
      config,
      rfpText,
      constraints,
      annexure,
      new OpportunityIntelligenceService(),
    );
  };

  it("builds checklist payload from PDF input text extraction", async () => {
    const service = makeService(`
Submission mode: email submission.
Concept note: 1200 words.
Budget to be submitted in Excel format.
Attachments: organizational profile, audited statements.
Annexure C: Declaration form.
`);

    const doc = await service.buildOpportunityDocument({
      parsed: {
        messageId: "msg-1234567890",
        threadId: "thread-1",
        subject: "Youth Learning Grant RFP",
        from: { email: "rfp@acme.org", name: "Acme Foundation" },
        to: ["funding@suchi.org"],
        cc: [],
        date: "2026-02-01T09:00:00.000Z",
        bodyPlain: "Please find attached RFP.",
        attachmentIds: [],
      },
      archive: {
        driveFolderId: "drive-folder-1",
        driveFolderUrl: "https://drive.example/folder",
        folderPath: "Fundbot/Opportunities/2026/Acme",
        attachmentResults: [
          {
            fileName: "rfp.pdf",
            driveFileId: "drive-file-1",
            driveUrl: "https://drive.example/rfp.pdf",
            checksum: "sha256:abc",
            sizeBytes: 100,
          },
        ],
      },
      attachmentBuffers: [
        {
          filename: "rfp.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("fake-pdf-binary"),
          driveFileId: "drive-file-1",
          driveUrl: "https://drive.example/rfp.pdf",
          checksum: "sha256:abc",
          sizeBytes: 100,
        },
      ],
    });

    const checklist = doc.opportunity.extractedRequirements?.submissionChecklist;
    expect(checklist).toBeDefined();
    expect(checklist?.wordLimits.length).toBeGreaterThanOrEqual(1);
    expect(checklist?.attachments.length).toBeGreaterThanOrEqual(1);
    expect(checklist?.annexures.length).toBeGreaterThanOrEqual(1);
    expect(doc.opportunity.triageCard).toBeDefined();
    expect(doc.opportunity.fitAssessment?.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

