import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateGiftDto } from "./gift.dto";
import { Prisma } from "@prisma/client";

/** Indian PAN format: 5 letters, 4 digits, 1 letter. */
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
function isValidPAN(pan: string | null | undefined): boolean {
  if (!pan || typeof pan !== "string") return false;
  return PAN_REGEX.test(pan.trim().toUpperCase());
}

export type Compliance10BdStatus =
  | "ready_for_10bd"
  | "missing_pan"
  | "missing_contact"
  | "cash_gt_2000_risk";

/** Evaluate 10BD/10BE readiness for a DOMESTIC_80G gift. */
export function evaluate10BdReadiness(g: {
  fundingLane: string;
  amount: Prisma.Decimal | number;
  mode: string;
  pan: string | null;
  contactEmail: string | null;
  contactMobile: string | null;
}): Compliance10BdStatus | null {
  if (g.fundingLane !== "DOMESTIC_80G") return null;
  const amount = Number(g.amount);
  if (g.mode.toLowerCase() === "cash" && amount > 2000) {
    return "cash_gt_2000_risk";
  }
  if (!isValidPAN(g.pan)) return "missing_pan";
  const hasContact =
    (g.contactEmail && g.contactEmail.trim() !== "") ||
    (g.contactMobile && g.contactMobile.trim() !== "");
  if (!hasContact) return "missing_contact";
  return "ready_for_10bd";
}

/** Derive Indian FY (e.g. "2024-25") from a date. April–March. */
export function deriveFY(date: Date): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 0-indexed
  if (month >= 4) return `${year}-${String(year + 1).slice(-2)}`;
  return `${year - 1}-${String(year).slice(-2)}`;
}

@Injectable()
export class GiftService {
  private readonly logger = new Logger(GiftService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateGiftDto) {
    const dateReceived = new Date(dto.dateReceived);
    const fy = dto.fy ?? deriveFY(dateReceived);
    const complianceStatus = evaluate10BdReadiness({
      fundingLane: dto.fundingLane,
      amount: dto.amount,
      mode: dto.mode,
      pan: dto.pan ?? null,
      contactEmail: dto.contactEmail ?? null,
      contactMobile: dto.contactMobile ?? null,
    });
    const gift = await this.prisma.gift.create({
      data: {
        donorName: dto.donorName,
        donorType: dto.donorType,
        amount: new Prisma.Decimal(dto.amount),
        dateReceived,
        mode: dto.mode,
        txnRef: dto.txnRef ?? null,
        mappedBankCredit: dto.mappedBankCredit ?? false,
        fundingLane: dto.fundingLane,
        purposeRestriction: dto.purposeRestriction ?? null,
        fy,
        complianceStatus,
        pan: dto.pan ?? null,
        contactEmail: dto.contactEmail ?? null,
        contactMobile: dto.contactMobile ?? null,
      },
    });
    this.logger.log(`Gift logged: ${gift.donorName} ${gift.amount} (${gift.id})`);
    return this.toGiftResponse(gift);
  }

  /** Top N DOMESTIC_80G gifts blocking 10BD readiness (not ready_for_10bd), by amount desc. */
  async get10BdBlockingGifts(limit = 20) {
    const list = await this.prisma.gift.findMany({
      where: {
        fundingLane: "DOMESTIC_80G",
        complianceStatus: { not: "ready_for_10bd" },
      },
      orderBy: { amount: "desc" },
      take: limit,
    });
    return {
      gifts: list.map((g) => this.toGiftResponse(g)),
      count: list.length,
      generatedAt: new Date().toISOString(),
    };
  }

  async findMissingBankMatch(limit = 50) {
    const list = await this.prisma.gift.findMany({
      where: { mappedBankCredit: false },
      orderBy: { dateReceived: "desc" },
      take: limit,
    });
    return { gifts: list.map((g) => this.toGiftResponse(g)), count: list.length };
  }

  async findByFy(fy: string) {
    const list = await this.prisma.gift.findMany({
      where: { fy },
      orderBy: { dateReceived: "asc" },
    });
    const total = list.reduce(
      (sum, g) => sum + Number(g.amount),
      0,
    );
    return { fy, gifts: list.map((g) => this.toGiftResponse(g)), count: list.length, total };
  }

  async getById(id: string) {
    const gift = await this.prisma.gift.findUnique({ where: { id } });
    if (!gift) throw new NotFoundException(`Gift ${id} not found`);
    return this.toGiftResponse(gift);
  }

  private toGiftResponse(g: {
    id: string;
    donorName: string;
    donorType: string;
    amount: Prisma.Decimal;
    dateReceived: Date;
    mode: string;
    txnRef: string | null;
    mappedBankCredit: boolean;
    fundingLane: string;
    purposeRestriction: string | null;
    fy: string;
    complianceStatus: string | null;
    pan: string | null;
    contactEmail: string | null;
    contactMobile: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: g.id,
      donorName: g.donorName,
      donorType: g.donorType,
      amount: Number(g.amount),
      dateReceived: g.dateReceived.toISOString(),
      mode: g.mode,
      txnRef: g.txnRef ?? undefined,
      mappedBankCredit: g.mappedBankCredit,
      fundingLane: g.fundingLane,
      purposeRestriction: g.purposeRestriction ?? undefined,
      fy: g.fy,
      complianceStatus: g.complianceStatus ?? undefined,
      pan: g.pan ?? undefined,
      contactEmail: g.contactEmail ?? undefined,
      contactMobile: g.contactMobile ?? undefined,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    };
  }
}
