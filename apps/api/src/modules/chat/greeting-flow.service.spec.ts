import { Test, TestingModule } from "@nestjs/testing";
import { GreetingFlowService } from "./greeting-flow.service";
import { PrismaService } from "../prisma/prisma.service";

describe("GreetingFlowService (silent session-context extraction)", () => {
  let service: GreetingFlowService;
  // `any` so we can drive the raw-SQL mock ($executeRawUnsafe).
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GreetingFlowService,
        {
          provide: PrismaService,
          // Writes go through $executeRawUnsafe to tolerate schema drift.
          useValue: {
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
          },
        },
      ],
    }).compile();

    service = module.get<GreetingFlowService>(GreetingFlowService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe("extractContextFromMessage", () => {
    it("should extract patient context from symptoms", async () => {
      const result = await service.extractContextFromMessage(
        "I have been experiencing chest pain"
      );

      expect(result.context).toBe("patient");
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it("should extract caregiver context", async () => {
      const result = await service.extractContextFromMessage(
        "My father has cancer"
      );

      expect(result.context).toBe("caregiver");
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it("should extract general intent", async () => {
      const result = await service.extractContextFromMessage(
        "I'm just asking generally about cancer"
      );

      expect(result.context).toBe("general");
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it("should extract cancer type", async () => {
      const result = await service.extractContextFromMessage(
        "I have breast cancer symptoms"
      );

      expect(result.cancerType).toBe("breast");
    });
  });

  describe("updateSessionContext", () => {
    it("should update session with all provided context", async () => {
      await service.updateSessionContext("session-1", {
        userContext: "patient",
        cancerType: "breast",
        emotionalState: "anxious",
      });

      // Written via dynamic raw SQL: values bound in field order, then the session id.
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'UPDATE "Session" SET "userContext" = $1, "cancerType" = $2, "emotionalState" = $3 WHERE id = $4',
        "patient",
        "breast",
        "anxious",
        "session-1"
      );
    });

    it("never writes the greeting-questionnaire columns", async () => {
      await service.updateSessionContext("session-1", { cancerType: "lung" });

      const sql = prisma.$executeRawUnsafe.mock.calls[0][0] as string;
      expect(sql).not.toContain("greetingCompleted");
      expect(sql).not.toContain("currentGreetingStep");
    });

    it("does nothing when no field is provided", async () => {
      await service.updateSessionContext("session-1", {});

      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });
});
