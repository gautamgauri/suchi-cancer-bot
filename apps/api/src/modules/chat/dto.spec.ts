import "reflect-metadata";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { ChatDto, MAX_USER_TEXT_LENGTH } from "./dto";

// Same options as main.ts, so this exercises the real rejection path.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: Record<string, unknown>) =>
  pipe.transform(body, { type: "body", metatype: ChatDto });

const base = { sessionId: "3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b", channel: "web" };

describe("ChatDto.userText length bound", () => {
  it("is 4096, matching Meta's WhatsApp inbound text cap", () => {
    expect(MAX_USER_TEXT_LENGTH).toBe(4096);
  });

  it("accepts a message exactly at the limit (e.g. a pasted report)", async () => {
    const dto = await validate({ ...base, userText: "a".repeat(MAX_USER_TEXT_LENGTH) });
    expect(dto.userText).toHaveLength(MAX_USER_TEXT_LENGTH);
  });

  it("rejects an over-length message with a 400 and a readable message", async () => {
    const err = await validate({ ...base, userText: "a".repeat(MAX_USER_TEXT_LENGTH + 1) }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    const messages: string[] = (err.getResponse() as any).message;
    expect(messages.join(" ")).toMatch(/userText must be at most 4096 characters/);
  });

  it("counts characters, not bytes (Devanagari at the limit is accepted)", async () => {
    const dto = await validate({ ...base, userText: "क".repeat(MAX_USER_TEXT_LENGTH) });
    expect(dto.userText).toHaveLength(MAX_USER_TEXT_LENGTH);
  });
});
