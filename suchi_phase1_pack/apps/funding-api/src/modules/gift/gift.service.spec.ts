import { Test, TestingModule } from "@nestjs/testing";
import { GiftService, evaluate10BdReadiness, deriveFY } from "./gift.service";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "@prisma/client";

describe("GiftService", () => {
  let giftService: GiftService;

  const mockPrisma = {
    gift: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GiftService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    giftService = module.get<GiftService>(GiftService);
  });

  describe("evaluate10BdReadiness", () => {
    it("returns null for non-DOMESTIC_80G lane", () => {
      expect(
        evaluate10BdReadiness({
          fundingLane: "CSR",
          amount: 5000,
          mode: "NEFT",
          pan: "ABCDE1234F",
          contactEmail: "a@b.com",
          contactMobile: null,
        }),
      ).toBeNull();
    });

    it("returns cash_gt_2000_risk for DOMESTIC_80G cash > 2000", () => {
      expect(
        evaluate10BdReadiness({
          fundingLane: "DOMESTIC_80G",
          amount: 3000,
          mode: "cash",
          pan: "ABCDE1234F",
          contactEmail: "a@b.com",
          contactMobile: null,
        }),
      ).toBe("cash_gt_2000_risk");
    });

    it("returns missing_pan when PAN invalid", () => {
      expect(
        evaluate10BdReadiness({
          fundingLane: "DOMESTIC_80G",
          amount: 1000,
          mode: "UPI",
          pan: null,
          contactEmail: "a@b.com",
          contactMobile: "9999999999",
        }),
      ).toBe("missing_pan");
      expect(
        evaluate10BdReadiness({
          fundingLane: "DOMESTIC_80G",
          amount: 1000,
          mode: "UPI",
          pan: "bad",
          contactEmail: "a@b.com",
          contactMobile: null,
        }),
      ).toBe("missing_pan");
    });

    it("returns missing_contact when no email or mobile", () => {
      expect(
        evaluate10BdReadiness({
          fundingLane: "DOMESTIC_80G",
          amount: 1000,
          mode: "UPI",
          pan: "ABCDE1234F",
          contactEmail: null,
          contactMobile: null,
        }),
      ).toBe("missing_contact");
    });

    it("returns ready_for_10bd when PAN and contact present", () => {
      expect(
        evaluate10BdReadiness({
          fundingLane: "DOMESTIC_80G",
          amount: 1000,
          mode: "UPI",
          pan: "ABCDE1234F",
          contactEmail: "a@b.com",
          contactMobile: null,
        }),
      ).toBe("ready_for_10bd");
      expect(
        evaluate10BdReadiness({
          fundingLane: "DOMESTIC_80G",
          amount: 5000,
          mode: "NEFT",
          pan: "XYZAB9876C",
          contactEmail: null,
          contactMobile: "9876543210",
        }),
      ).toBe("ready_for_10bd");
    });
  });

  describe("deriveFY", () => {
    it("returns next FY for April–March", () => {
      expect(deriveFY(new Date("2024-06-15"))).toBe("2024-25");
      expect(deriveFY(new Date("2025-01-01"))).toBe("2024-25");
      expect(deriveFY(new Date("2025-03-31"))).toBe("2024-25");
      expect(deriveFY(new Date("2025-04-01"))).toBe("2025-26");
    });
  });

  describe("get10BdBlockingGifts", () => {
    it("returns empty list when no blocking gifts", async () => {
      mockPrisma.gift.findMany.mockResolvedValue([]);
      const result = await giftService.get10BdBlockingGifts(20);
      expect(result.gifts).toEqual([]);
      expect(result.count).toBe(0);
    });
  });
});
