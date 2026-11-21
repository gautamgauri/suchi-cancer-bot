import "reflect-metadata";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { ChatDto, MAX_USER_TEXT_HARD_LIMIT, MAX_USER_TEXT_LENGTH, boundUserText, cutToLength } from "./dto";

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

  // PR #202: a 400 reached the patient as a generic error, so a long message
  // that opened with an emergency got no safety reply. Text above the
  // pipeline bound is accepted here and cut on the server.
  it("accepts text above the pipeline bound, up to the abuse ceiling", async () => {
    const dto = await validate({ ...base, userText: "a".repeat(MAX_USER_TEXT_HARD_LIMIT) });
    expect(dto.userText).toHaveLength(MAX_USER_TEXT_HARD_LIMIT);
  });

  // Review N3: no length is refused. ChatService cuts at the ceiling instead.
  it("accepts text above the abuse ceiling, which ChatService then cuts", async () => {
    expect(MAX_USER_TEXT_HARD_LIMIT).toBeGreaterThanOrEqual(4 * MAX_USER_TEXT_LENGTH);
    const dto = await validate({ ...base, userText: "a".repeat(30_000) });
    expect(dto.userText).toHaveLength(30_000);
  });

  it("the abuse ceiling in Devanagari still fits the default 100 kB JSON body limit", () => {
    const body = JSON.stringify({ ...base, userText: "क".repeat(MAX_USER_TEXT_HARD_LIMIT) });
    expect(Buffer.byteLength(body, "utf8")).toBeLessThan(100 * 1024);
  });

  it("boundUserText cuts to the pipeline bound and leaves shorter text alone", () => {
    expect(boundUserText("a".repeat(MAX_USER_TEXT_LENGTH + 500))).toHaveLength(MAX_USER_TEXT_LENGTH);
    expect(boundUserText("short")).toBe("short");
  });

  it("never leaves half an emoji at the cut", () => {
    // The emoji's two UTF-16 halves sit at positions 4095 and 4096.
    const text = "a".repeat(MAX_USER_TEXT_LENGTH - 1) + "\u{1F600}" + "tail";
    expect(text.charCodeAt(MAX_USER_TEXT_LENGTH - 1)).toBe(0xd83d);
    const cut = boundUserText(text);
    expect(cut).toBe("a".repeat(MAX_USER_TEXT_LENGTH - 1));
    expect(/[\uD800-\uDBFF]$/.test(cut)).toBe(false);
    // An emoji that ends exactly at the bound is kept whole.
    const whole = "a".repeat(MAX_USER_TEXT_LENGTH - 2) + "\u{1F600}" + "tail";
    expect(boundUserText(whole)).toBe("a".repeat(MAX_USER_TEXT_LENGTH - 2) + "\u{1F600}");
    expect(cutToLength("ab", 5)).toBe("ab");
  });

  it("counts characters, not bytes (Devanagari at the limit is accepted)", async () => {
    const dto = await validate({ ...base, userText: "क".repeat(MAX_USER_TEXT_LENGTH) });
    expect(dto.userText).toHaveLength(MAX_USER_TEXT_LENGTH);
  });
});
