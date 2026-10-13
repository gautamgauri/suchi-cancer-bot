import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { BasicAuthGuard } from "../../common/guards/basic-auth.guard";
import { CopilotController } from "./copilot.controller";
import { CopilotService } from "./copilot.service";

describe("CopilotController auth", () => {
  it("is guarded by BasicAuthGuard at class level (covers every route)", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CopilotController)).toEqual([BasicAuthGuard]);
  });

  describe("over HTTP", () => {
    let app: INestApplication;
    let base: string;
    const copilot = {
      createSession: jest.fn().mockResolvedValue({ id: "s1", userText: "stored patient text" }),
      getSession: jest.fn().mockResolvedValue({ id: "s1" }),
      diagnose: jest.fn().mockResolvedValue({}),
      plan: jest.fn().mockResolvedValue({}),
      approve: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
      execute: jest.fn().mockResolvedValue({}),
      compare: jest.fn().mockResolvedValue({}),
    };

    const savedEnv = { user: process.env.ADMIN_BASIC_USER, pass: process.env.ADMIN_BASIC_PASS };

    beforeAll(async () => {
      process.env.ADMIN_BASIC_USER = "ops";
      process.env.ADMIN_BASIC_PASS = "s3cret";
      const mod = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ ignoreEnvFile: true })],
        controllers: [CopilotController],
        providers: [{ provide: CopilotService, useValue: copilot }],
      }).compile();
      app = mod.createNestApplication({ logger: false });
      await app.listen(0, "127.0.0.1");
      const { port } = app.getHttpServer().address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      if (savedEnv.user === undefined) delete process.env.ADMIN_BASIC_USER; else process.env.ADMIN_BASIC_USER = savedEnv.user;
      if (savedEnv.pass === undefined) delete process.env.ADMIN_BASIC_PASS; else process.env.ADMIN_BASIC_PASS = savedEnv.pass;
    });

    beforeEach(() => jest.clearAllMocks());

    const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
    const post = (path: string, auth?: string) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
        body: JSON.stringify({ chatSessionId: "c1", messageId: "m1" }),
      });

    it.each([
      ["POST", "/copilot/sessions"],
      ["GET", "/copilot/sessions/s1"],
      ["POST", "/copilot/sessions/s1/diagnose"],
      ["POST", "/copilot/sessions/s1/plan"],
      ["POST", "/copilot/sessions/s1/execute"],
      ["POST", "/copilot/sessions/s1/compare"],
    ])("%s %s returns 401 without credentials and never reaches the service", async (method, path) => {
      const res = await fetch(`${base}${path}`, { method });
      expect(res.status).toBe(401);
      for (const fn of Object.values(copilot)) expect(fn).not.toHaveBeenCalled();
    });

    it("rejects wrong credentials", async () => {
      const res = await post("/copilot/sessions", basic("ops", "wrong"));
      expect(res.status).toBe(401);
      expect(copilot.createSession).not.toHaveBeenCalled();
    });

    it("allows the operator with valid Basic credentials", async () => {
      const res = await post("/copilot/sessions", basic("ops", "s3cret"));
      expect(res.status).toBe(201);
      expect(copilot.createSession).toHaveBeenCalledWith("c1", "m1");
    });
  });
});
