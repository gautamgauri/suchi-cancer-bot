import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppModule } from "./whatsapp.module";
import { WhatsAppService } from "./whatsapp.service";

// PR #248 injects three more providers into WhatsAppService (SafetyService,
// AbstentionService and EmpathyDetector). Unit specs construct the service by
// hand, so only a real module compile proves Nest can resolve them.
describe("WhatsAppModule", () => {
  it("compiles and resolves WhatsAppService with every injected provider", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), WhatsAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    const svc = moduleRef.get(WhatsAppService);
    expect(svc).toBeInstanceOf(WhatsAppService);
    for (const dep of ["safety", "abstention", "empathy", "chat", "sessions"]) {
      expect((svc as any)[dep]).toBeDefined();
    }
    await moduleRef.close();
  });
});
