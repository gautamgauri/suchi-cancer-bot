import { Test, TestingModule } from "@nestjs/testing";
import { WhatsAppNavigatorFlowService } from "./whatsapp-navigator-flow.service";
import { NavigatorSession } from "./whatsapp-navigator.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<NavigatorSession> = {}): NavigatorSession {
  return {
    sessionId: "test-session-id",
    phone: "+919876543210",
    step: "start",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WhatsAppNavigatorFlowService", () => {
  let service: WhatsAppNavigatorFlowService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WhatsAppNavigatorFlowService],
    }).compile();

    service = module.get<WhatsAppNavigatorFlowService>(
      WhatsAppNavigatorFlowService
    );

    // Trigger onModuleInit so hospitals.json is loaded
    await service.onModuleInit();
  });

  // -------------------------------------------------------------------------
  // Test 1: Start flow returns state selection options
  // -------------------------------------------------------------------------
  it("start flow returns welcome message and state selection options", () => {
    const session = makeSession({ step: "start" });
    const { response, updatedSession } = service.processMessage(session, "");

    expect(response.text).toContain("Suchi Cancer Navigator");
    expect(response.options).toBeDefined();
    expect(response.options!.length).toBeGreaterThanOrEqual(4);

    const keys = response.options!.map((o) => o.key);
    expect(keys).toContain("1"); // Bihar
    expect(keys).toContain("2"); // Jharkhand

    expect(updatedSession.step).toBe("select_state");
  });

  // -------------------------------------------------------------------------
  // Test 2: Step progression through the full flow
  // -------------------------------------------------------------------------
  it("session step progresses correctly through start → state → cancer → affordability → results", () => {
    // Step 1: start
    let session = makeSession({ step: "start" });
    let result = service.processMessage(session, "");
    expect(result.updatedSession.step).toBe("select_state");

    // Step 2: select Bihar (key "1")
    session = result.updatedSession;
    result = service.processMessage(session, "1");
    expect(result.updatedSession.step).toBe("select_cancer_type");
    expect(result.updatedSession.state).toBe("Bihar");

    // Step 3: select Oral cancer (key "1")
    session = result.updatedSession;
    result = service.processMessage(session, "1");
    expect(result.updatedSession.step).toBe("select_affordability");
    expect(result.updatedSession.cancerType).toBe("oral_head_neck");

    // Step 4: select Government only (key "1")
    session = result.updatedSession;
    result = service.processMessage(session, "1");
    expect(result.updatedSession.step).toBe("end");
    expect(result.updatedSession.affordability).toBe("government_only");
  });

  // -------------------------------------------------------------------------
  // Test 3: Bihar + Oral cancer + Government only returns Bihar PMJAY hospitals
  // -------------------------------------------------------------------------
  it("Bihar + oral cancer + government only returns matching Bihar hospitals", () => {
    // Manually build a session already at the affordability step with context
    const session = makeSession({
      step: "select_affordability",
      state: "Bihar",
      cancerType: "oral_head_neck",
    });

    const { response } = service.processMessage(session, "1"); // government_only

    // Should contain hospital result text
    expect(response.text).toBeDefined();

    // Disclaimer must always be present
    expect(response.text).toContain("This is information only");

    // Should NOT be an error — should have at least one hospital card marker
    // Bihar has AIIMS Patna and HBCH Muzaffarpur which cover surgical/radiation oncology
    const hasHospitalCard =
      response.text.includes("🏥") || response.text.includes("Bihar");
    expect(hasHospitalCard).toBe(true);

    // Cost label should indicate free/PMJAY or government
    const hasCostLabel =
      response.text.includes("PMJAY") ||
      response.text.includes("Government") ||
      response.text.includes("Low cost") ||
      response.text.includes("मुफ़्त");
    expect(hasCostLabel).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 4: Invalid input re-prompts with same step
  // -------------------------------------------------------------------------
  it("invalid input at select_state re-prompts without advancing step", () => {
    const session = makeSession({ step: "select_state" });
    const { response, updatedSession } = service.processMessage(session, "99");

    expect(updatedSession.step).toBe("select_state");
    expect(response.options).toBeDefined();
    expect(response.text).toContain("valid");
  });

  // -------------------------------------------------------------------------
  // Test 5: Pediatric cancer type maps correctly
  // -------------------------------------------------------------------------
  it("pediatric cancer type selection advances correctly", () => {
    const session = makeSession({
      step: "select_cancer_type",
      state: "Bihar",
    });

    const { updatedSession } = service.processMessage(session, "6"); // pediatric
    expect(updatedSession.cancerType).toBe("pediatric");
    expect(updatedSession.step).toBe("select_affordability");
  });
});
