import { Test, TestingModule } from "@nestjs/testing";
import { GreetingFlowService } from "./greeting-flow.service";
import { PrismaService } from "../prisma/prisma.service";
import { EmpathyDetector } from "./empathy-detector";
import { LlmService } from "../llm/llm.service";

describe("GreetingFlowService", () => {
  let service: GreetingFlowService;
  // `any` so we can drive the raw-SQL mocks ($queryRaw / $executeRawUnsafe).
  let prisma: any;
  let empathyDetector: EmpathyDetector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GreetingFlowService,
        {
          provide: PrismaService,
          // The service reads session state via raw SQL ($queryRaw) and writes
          // via $executeRawUnsafe (to tolerate schema drift), and reads message
          // history via the typed client. Mock all four surfaces.
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([]),
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
            message: {
              count: jest.fn().mockResolvedValue(0),
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
        },
        {
          provide: EmpathyDetector,
          useValue: {
            detectEmotionalTone: jest.fn().mockResolvedValue({
              tone: "neutral",
              confidence: 0.5,
              keywords: [],
            }),
          },
        },
        {
          provide: LlmService,
          useValue: undefined, // Not used in rule-based tests
        },
      ],
    }).compile();

    service = module.get<GreetingFlowService>(GreetingFlowService);
    prisma = module.get<PrismaService>(PrismaService);
    empathyDetector = module.get<EmpathyDetector>(EmpathyDetector);
  });

  // The service reads session rows via $queryRaw, which returns an array.
  const sessionRow = (row: Record<string, unknown> | null) =>
    prisma.$queryRaw.mockResolvedValue(row ? [row] : []);

  describe("needsGreetingFlow", () => {
    it("should return false if session does not exist", async () => {
      sessionRow(null);

      const result = await service.needsGreetingFlow("session-1");
      expect(result).toBe(false);
    });

    it("should return false if greeting is already completed", async () => {
      sessionRow({ greetingCompleted: true });
      prisma.message.count.mockResolvedValue(5);

      const result = await service.needsGreetingFlow("session-1");
      expect(result).toBe(false);
    });

    it("should return true if greeting not completed and no messages", async () => {
      sessionRow({ greetingCompleted: false });
      prisma.message.count.mockResolvedValue(0);

      const result = await service.needsGreetingFlow("session-1");
      expect(result).toBe(true);
    });
  });

  describe("getGreetingStep", () => {
    it("should return 0 if session does not exist", async () => {
      sessionRow(null);

      const result = await service.getGreetingStep("session-1");
      expect(result).toBe(0);
    });

    it("should return 0 if greeting is completed", async () => {
      sessionRow({ greetingCompleted: true, userContext: null, cancerType: null });

      const result = await service.getGreetingStep("session-1");
      expect(result).toBe(0);
    });

    // Step is inferred from context + message history (the explicit
    // currentGreetingStep column is no longer read). With a known context and a
    // prior assistant turn but no cancer type yet, we are at step 2.
    it("should return step 2 when context is set and an assistant turn exists", async () => {
      sessionRow({ greetingCompleted: false, userContext: "patient", cancerType: null });
      prisma.message.findMany.mockResolvedValue([
        { role: "user" },
        { role: "assistant" },
        { role: "user" },
      ]);

      const result = await service.getGreetingStep("session-1");
      expect(result).toBe(2);
    });

    it("should infer step 1 if no assistant messages", async () => {
      sessionRow({ greetingCompleted: false, userContext: null, cancerType: null });
      prisma.message.findMany.mockResolvedValue([{ role: "user" }]);

      const result = await service.getGreetingStep("session-1");
      expect(result).toBe(1);
    });

    it("should infer step 2 if context exists but no cancer type", async () => {
      sessionRow({ greetingCompleted: false, userContext: "patient", cancerType: null });
      prisma.message.findMany.mockResolvedValue([
        { role: "user" },
        { role: "assistant" },
        { role: "user" },
      ]);

      const result = await service.getGreetingStep("session-1");
      expect(result).toBe(2);
    });
  });

  describe("isGreetingFlowInProgress", () => {
    it("should return false if session does not exist", async () => {
      sessionRow(null);

      const result = await service.isGreetingFlowInProgress("session-1");
      expect(result).toBe(false);
    });

    it("should return false if greeting is completed", async () => {
      sessionRow({ greetingCompleted: true });

      const result = await service.isGreetingFlowInProgress("session-1");
      expect(result).toBe(false);
    });

    // "In progress" is inferred from the presence of assistant turns (the flow
    // has started but not completed), not from an explicit step column.
    it("should return true if greeting not completed and an assistant turn exists", async () => {
      sessionRow({ greetingCompleted: false });
      prisma.message.count.mockResolvedValue(1);

      const result = await service.isGreetingFlowInProgress("session-1");
      expect(result).toBe(true);
    });

    it("should return false if no assistant turns yet", async () => {
      sessionRow({ greetingCompleted: false });
      prisma.message.count.mockResolvedValue(0);

      const result = await service.isGreetingFlowInProgress("session-1");
      expect(result).toBe(false);
    });
  });

  describe("handleGreetingFlowInterruption", () => {
    it("should complete greeting flow silently with extracted context", async () => {
      sessionRow({
        greetingCompleted: false,
        userContext: null,
        cancerType: null,
        emotionalState: null,
      });

      const contextResult = {
        context: "patient" as const,
        cancerType: "breast",
        confidence: 0.85,
      };

      await service.handleGreetingFlowInterruption(
        "session-1",
        contextResult,
        "anxious"
      );

      // updateSessionContext writes via $executeRawUnsafe(sql, ...values, step, id)
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "Session"'),
        "patient",
        "breast",
        "anxious",
        true,
        3,
        "session-1"
      );
    });

    it("should not update if greeting is already completed", async () => {
      sessionRow({ greetingCompleted: true });

      await service.handleGreetingFlowInterruption(
        "session-1",
        { context: "patient", confidence: 0.85 },
        "neutral"
      );

      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });
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

  describe("parseGreetingResponse", () => {
    it("should progress from step 1 to step 2 for patient context", async () => {
      jest.spyOn(service, "extractContextFromMessage").mockResolvedValue({
        context: "patient",
        confidence: 0.85,
      });

      const result = await service.parseGreetingResponse("I'm a patient", 1);

      expect(result.nextStep).toBe(2);
      expect(result.context).toBe("patient");
    });

    it("should progress from step 1 to step 3 for general context", async () => {
      jest.spyOn(service, "extractContextFromMessage").mockResolvedValue({
        context: "general",
        confidence: 0.95,
      });

      const result = await service.parseGreetingResponse(
        "Just asking generally",
        1
      );

      expect(result.nextStep).toBe(3);
      expect(result.context).toBe("general");
    });

    it("should complete step 2 when cancer type is provided", async () => {
      jest.spyOn(service, "extractContextFromMessage").mockResolvedValue({
        context: "patient",
        cancerType: "breast",
        confidence: 0.85,
      });

      const result = await service.parseGreetingResponse("breast cancer", 2);

      expect(result.nextStep).toBe(3);
      expect(result.cancerType).toBe("breast");
    });

    it("should allow completion at step 2 with 'not sure'", async () => {
      jest.spyOn(service, "extractContextFromMessage").mockResolvedValue({
        context: "patient",
        confidence: 0.85,
      });

      const result = await service.parseGreetingResponse("I'm not sure", 2);

      expect(result.nextStep).toBe(3);
    });
  });

  describe("updateSessionContext", () => {
    it("should update session with all provided context", async () => {
      await service.updateSessionContext("session-1", {
        userContext: "patient",
        cancerType: "breast",
        emotionalState: "anxious",
        greetingCompleted: true,
        currentGreetingStep: 3,
      });

      // Written via dynamic raw SQL: values bound in field order, then the
      // currentGreetingStep, then the session id.
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "Session"'),
        "patient",
        "breast",
        "anxious",
        true,
        3,
        "session-1"
      );
    });
  });
});
