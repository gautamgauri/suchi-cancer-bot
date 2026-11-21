import { Logger, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ChatService } from "./chat.service";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Review N1 of PR #202. On shutdown, ChatService must drain its pending safety
 * writes while the database connection is still open, so the drain must
 * finish before PrismaService disconnects.
 *
 * This boots the real, global PrismaModule beside a module that provides
 * ChatService, closes the application as SIGTERM would (with Nest's shutdown
 * hooks), and records the order. Under Nest 10 the global PrismaModule's
 * onModuleDestroy runs BEFORE ChatModule's, which is why the disconnect moved
 * to onApplicationShutdown and the drain to beforeApplicationShutdown.
 */
describe("Shutdown order: safety-write drain before the Prisma disconnect", () => {
  afterEach(() => jest.restoreAllMocks());

  it("drains before disconnecting", async () => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const order: string[] = [];
    jest.spyOn(PrismaService.prototype, "$connect").mockImplementation(async () => undefined);
    jest.spyOn(PrismaService.prototype, "$disconnect").mockImplementation(async () => {
      order.push("prisma.disconnect");
    });
    const drain = ChatService.prototype.beforeApplicationShutdown;
    jest.spyOn(ChatService.prototype, "beforeApplicationShutdown").mockImplementation(async function (this: ChatService) {
      order.push("chat.drain:start");
      await drain.call(this);
      order.push("chat.drain:end");
    });

    // ChatService with its real lifecycle methods and stub collaborators. The
    // drain only needs its own state, so the other dependencies are not used.
    @Module({
      providers: [
        {
          provide: ChatService,
          inject: [PrismaService],
          useFactory: (prisma: PrismaService) => {
            const svc = Object.create(ChatService.prototype);
            Object.assign(svc, {
              prisma,
              logger: new Logger("ChatService"),
              backgroundWrites: new Set<Promise<void>>(),
              SHUTDOWN_DRAIN_MS: 3_000,
            });
            // One pending write, so the drain has something to wait for.
            let release!: () => void;
            const pending = new Promise<void>((r) => (release = r)).then(() => {
              order.push("chat.write:landed");
            });
            svc.backgroundWrites.add(pending);
            setTimeout(() => release(), 20);
            return svc;
          },
        },
      ],
    })
    class ChatHostModule {}

    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, ChatHostModule] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    app.enableShutdownHooks();
    await app.init();
    await app.close();

    expect(order).toEqual(["chat.drain:start", "chat.write:landed", "chat.drain:end", "prisma.disconnect"]);
  });
});
