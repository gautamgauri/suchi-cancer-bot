import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FunderScraperService } from "./funder-scraper.service";

@Controller("funder-orgs")
export class FunderScraperController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly funderScraper: FunderScraperService,
  ) {}

  @Get()
  async listOrgs() {
    return this.prisma.funderOrg.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { funders: true } } },
    });
  }

  @Post()
  async addOrg(
    @Body()
    body: { orgName: string; orgWebsite: string; network: string },
  ) {
    const { orgName, orgWebsite, network } = body;
    if (!orgName?.trim() || !orgWebsite?.trim() || !network?.trim()) {
      return { error: "orgName, orgWebsite, and network are required" };
    }
    return this.prisma.funderOrg.create({
      data: {
        orgName: orgName.trim(),
        orgWebsite: orgWebsite.trim(),
        network: network.trim(),
        status: "pending",
      },
    });
  }

  @Get(":id/funders")
  async getFunders(@Param("id", ParseUUIDPipe) id: string) {
    return this.prisma.funderFact.findMany({
      where: { funderOrgId: id },
      orderBy: { matchConfidence: "desc" },
    });
  }

  @Post(":id/retry")
  async retry(@Param("id", ParseUUIDPipe) id: string) {
    const org = await this.prisma.funderOrg.findUnique({ where: { id } });
    if (!org) return { error: "FunderOrg not found" };
    if (org.status !== "failed") {
      return { message: "Org is not in failed state", org };
    }
    return this.prisma.funderOrg.update({
      where: { id },
      data: { status: "pending", error: null },
    });
  }

  @Post(":id/run-now")
  async runNow(@Param("id", ParseUUIDPipe) id: string) {
    const org = await this.prisma.funderOrg.findUnique({ where: { id } });
    if (!org) return { error: "FunderOrg not found" };

    const facts = await this.funderScraper.scrapeOrg({
      id: org.id,
      orgName: org.orgName,
      orgWebsite: org.orgWebsite,
      network: org.network,
    });

    await this.prisma.$transaction([
      this.prisma.funderFact.deleteMany({ where: { funderOrgId: org.id } }),
      this.prisma.funderFact.createMany({
        data: facts.map((f) => ({
          funderOrgId: org.id,
          orgName: f.org_name,
          orgWebsite: f.org_website,
          network: f.network,
          funderName: f.funder_name,
          funderType: f.funder_type,
          evidenceType: f.evidence_type,
          evidenceExcerpt: f.evidence_excerpt,
          evidenceUrl: f.evidence_url,
          financialAmount: f.financial_amount,
          grantYears: f.grant_years,
          programFocus: f.program_focus,
          geography: f.geography,
          confidenceScore: f.confidence_score,
          notes: f.notes,
          normalizedFunder: f.normalized_funder,
          matchConfidence: f.match_confidence,
        })),
      }),
    ]);

    await this.prisma.funderOrg.update({
      where: { id },
      data: { status: "done", lastRunAt: new Date(), error: null },
    });

    return { orgId: id, fundersFound: facts.length, facts };
  }
}
