import { Test, TestingModule } from "@nestjs/testing";
import { GreetingFlowService } from "./greeting-flow.service";
import { PrismaService } from "../prisma/prisma.service";
import { EmpathyDetector } from "./empathy-detector";
import { LlmService } from "../llm/llm.service";

describe("GreetingFlowService", () => {
  let service: GreetingFlowService;
  let prisma: PrismaService;
  let empathyDetector: EmpathyDetector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GreetingFlowService,
        {
          provide: PrismaService,
          useValue: {
            session: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            message: {
              count: jest.fn(),
              findMany: jest.fn(),
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

  describe("needsGreetingFlow", () => {
    it("should return false if session does not exist", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.needsGreetingFlow("session-1");
      expect(result).toBe(false);
    });

    it("should return false if greeting is already completed", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        id: "session-1",
        greetingCompleted: true,
      });
      (prisma.message.count as jest.Mock).mockResolvedValue(5);

      const result = await service.needsGreetingFlow("session-1");
      expect(result).toBe(false);
    });

    it("should return true if greeting not completed and no messages", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        id: "session-1",
        greetingCompleted: false,
      });
      (prisma.message.count as jest.Mock).mockResolvedValue(0);

      const result = await service.needsGreetingFlow("session-1");
      expect(result).toBe(true);
    });
  });

  describe("getGreetingStep", () => {
    it("should return 0 if session does not exist", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getGreetingStep("session-1");
      expect(result).toBe(0);
    });

    it("should return 0 if greeting is completed", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        id: "session-1",
        greetingCompleted: true,
        currentGreetingStep: 3,
      });

      const result = await service.getGreetingStep("session-1");
      expect(result).toBe(0);
    });

    it("should return explicit step if available", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        id: "session-1",
        greetingCompleted: false,
        currentGreetingStep: 2,
        userContext: "patient",
        cancerType: null,
      });

      const result = await service.getGreetingStep("session-1");
      expect(result).toBe(2);
    });

    it("should infer step 1 if no assistant messages", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        id: "session-1",
        greetingCompleted: false,
        currentGreetingStep: null,
        userContext: null,
        cancerType: null,
      });
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        { role: "user", text: "hi" },
      ]);

      const result = await service.getGreetingStep("session-1");
      expect(result).toBe(1);
    });

    it("should infer step 2 if context exists but no cancer type", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        id: "session-1",
        greetingCompleted: false,
        currentGreetingStep: null,
        userContext: "patient",
        cancerType: null,
      });
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        { role: "user", text: "hi" },
        { role: "assistant", text: "Step 1 question" },
        { role: "user", text: "I'm a patient" },
      ]);

      const result = await service.getGreetingStep("session-1");
      expect(result).toBe(2);
    });
  });

  describe("isGreetingFlowInProgress", () => {
    it("should return false if session does not exist", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.isGreetingFlowInProgress("session-1");
      expect(result).toBe(false);
    });

    it("should return false if greeting is completed", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        greetingCompleted: true,
        currentGreetingStep: 3,
      });

      const result = await service.isGreetingFlowInProgress("session-1");
      expect(result).toBe(false);
    });

    it("should return true if greeting not completed and step > 0", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        greetingCompleted: false,
        currentGreetingStep: 1,
      });

      const result = await service.isGreetingFlowInProgress("session-1");
      expect(result).toBe(true);
    });

    it("should return false if step is 0 or null", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        greetingCompleted: false,
        currentGreetingStep: 0,
      });

      const result = await service.isGreetingFlowInProgress("session-1");
      expect(result).toBe(false);
    });
  });

  describe("handleGreetingFlowInterruption", () => {
    it("should complete greeting flow silently with extracted context", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        id: "session-1",
        greetingCompleted: false,
        userContext: null,
        cancerType: null,
        emotionalState: null,
      });
      (prisma.session.update as jest.Mock).mockResolvedValue({});

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

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: "session-1" },
        data: {
          userContext: "patient",
          cancerType: "breast",
          emotionalState: "anxious",
          greetingCompleted: true,
          currentGreetingStep: 3,
        },
      });
    });

    it("should not update if greeting is already completed", async () => {
      (prisma.session.findUnique as jest.Mock).mockResolvedValue({
        id: "session-1",
        greetingCompleted: true,
      });

      await service.handleGreetingFlowInterruption(
        "session-1",
        { context: "patient", confidence: 0.85 },
        "neutral"
      );

      expect(prisma.session.update).not.toHaveBeenCalled();
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
      (prisma.session.update as jest.Mock).mockResolvedValue({});

      await service.updateSessionContext("session-1", {
        userContext: "patient",
        cancerType: "breast",
        emotionalState: "anxious",
        greetingCompleted: true,
        currentGreetingStep: 3,
      });

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: "session-1" },
        data: {
          userContext: "patient",
          cancerType: "breast",
          emotionalState: "anxious",
          greetingCompleted: true,
          currentGreetingStep: 3,
        },
      });
    });
  });
});
