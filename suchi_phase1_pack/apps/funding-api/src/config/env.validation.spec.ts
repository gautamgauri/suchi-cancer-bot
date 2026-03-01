import { envSchema } from "./env.validation";

describe("env.validation", () => {
  const MINIMAL_VALID = {
    FUNDING_OPENAI_API_KEY: "sk-test-key",
    DATABASE_URL: "postgresql://localhost:5432/test",
  };

  it("accepts minimal required env vars", () => {
    const result = envSchema.safeParse(MINIMAL_VALID);
    expect(result.success).toBe(true);
  });

  it("rejects missing FUNDING_OPENAI_API_KEY", () => {
    const result = envSchema.safeParse({ DATABASE_URL: "postgresql://localhost:5432/test" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("FUNDING_OPENAI_API_KEY");
    }
  });

  it("rejects missing DATABASE_URL", () => {
    const result = envSchema.safeParse({ FUNDING_OPENAI_API_KEY: "sk-test" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("DATABASE_URL");
    }
  });

  it("applies defaults for optional fields", () => {
    const result = envSchema.safeParse(MINIMAL_VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.FUNDING_MODEL_DRAFT).toBe("deepseek-chat");
      expect(result.data.FUNDING_LLM_TIMEOUT_MS).toBe(45000);
      expect(result.data.FUNDING_EMBEDDING_PROVIDER).toBe("google");
      expect(result.data.FUNDING_SLACK_CHANNEL).toBe("#funding-bot");
    }
  });

  it("rejects invalid FUNDING_OPENAI_BASE_URL", () => {
    const result = envSchema.safeParse({
      ...MINIMAL_VALID,
      FUNDING_OPENAI_BASE_URL: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("coerces numeric strings", () => {
    const result = envSchema.safeParse({
      ...MINIMAL_VALID,
      PORT: "8080",
      FUNDING_LLM_TIMEOUT_MS: "30000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
      expect(result.data.FUNDING_LLM_TIMEOUT_MS).toBe(30000);
    }
  });

  it("rejects invalid embedding provider", () => {
    const result = envSchema.safeParse({
      ...MINIMAL_VALID,
      FUNDING_EMBEDDING_PROVIDER: "invalid",
    });
    expect(result.success).toBe(false);
  });
});
