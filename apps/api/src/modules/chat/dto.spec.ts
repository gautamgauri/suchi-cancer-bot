import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ChatDto, MAX_USER_TEXT_HARD_LIMIT, cutToLength } from "./dto";
import { SAFETY_TAIL_LENGTH, tailToLength } from "./deterministic-safety";

// Same options as main.ts, so this exercises the real validation path.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: Record<string, unknown>) =>
  pipe.transform(body, { type: "body", metatype: ChatDto });

const base = { sessionId: "3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b", channel: "web" };

describe("ChatDto.userText length", () => {
  // PR #202, review N3: no length is refused, as on main. A 400 reaches the
  // patient as a generic error even when the first line is an emergency.
  it("accepts text at and above the 20,000 character ceiling", async () => {
    for (const n of [4096, MAX_USER_TEXT_HARD_LIMIT, 30_000]) {
      const dto = await validate({ ...base, userText: "a".repeat(n) });
      expect(dto.userText).toHaveLength(n);
    }
  });

  it("the ceiling in Devanagari still fits the default 100 kB JSON body limit", () => {
    const body = JSON.stringify({ ...base, userText: "क".repeat(MAX_USER_TEXT_HARD_LIMIT) });
    expect(Buffer.byteLength(body, "utf8")).toBeLessThan(100 * 1024);
  });
});

describe("surrogate-safe cuts", () => {
  it("cutToLength never leaves half an emoji at the end", () => {
    const n = MAX_USER_TEXT_HARD_LIMIT;
    // The emoji's two UTF-16 halves sit at positions n - 1 and n.
    const text = "a".repeat(n - 1) + "\u{1F600}" + "tail";
    expect(text.charCodeAt(n - 1)).toBe(0xd83d);
    const cut = cutToLength(text, n);
    expect(cut).toBe("a".repeat(n - 1));
    expect(/[\uD800-\uDBFF]$/.test(cut)).toBe(false);
    // An emoji that ends exactly at the bound is kept whole.
    const whole = "a".repeat(n - 2) + "\u{1F600}" + "tail";
    expect(cutToLength(whole, n)).toBe("a".repeat(n - 2) + "\u{1F600}");
    expect(cutToLength("ab", 5)).toBe("ab");
  });

  it("tailToLength never starts with half an emoji", () => {
    const n = SAFETY_TAIL_LENGTH;
    // The emoji straddles the start of the tail.
    const text = "head" + "\u{1F600}" + "b".repeat(n - 1);
    const tail = tailToLength(text, n);
    expect(tail).toBe("b".repeat(n - 1));
    expect(/^[\uDC00-\uDFFF]/.test(tail)).toBe(false);
    expect(tailToLength("ab", 5)).toBe("ab");
  });
});
