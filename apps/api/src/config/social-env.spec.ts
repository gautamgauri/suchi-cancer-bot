import { envSchema } from "./env.validation";

describe("SOCIAL_PUBLISH_MODE validation", () => {
  const base = { DATABASE_URL: "postgres://x", ADMIN_BASIC_USER: "a", ADMIN_BASIC_PASS: "b", GEMINI_API_KEY: "k" };
  const parse = (v: unknown) => envSchema.safeParse({ ...base, SOCIAL_PUBLISH_MODE: v });

  it("defaults to dry_run", () => {
    const r = envSchema.safeParse(base);
    expect(r.success && r.data.SOCIAL_PUBLISH_MODE).toBe("dry_run");
  });

  it.each([["LIVE", "live"], [" Dry_Run ", "dry_run"], ["off", "off"]])("accepts %p as %p", (v, want) => {
    const r = parse(v);
    expect(r.success && r.data.SOCIAL_PUBLISH_MODE).toBe(want);
  });

  it("fails at boot with a clear message for anything else", () => {
    const r = parse("yes");
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toContain('SOCIAL_PUBLISH_MODE must be \\"live\\", \\"dry_run\\" or \\"off\\"');
  });

  it("keeps the generator off by default", () => {
    const r = envSchema.safeParse(base);
    expect(r.success && r.data.SOCIAL_GENERATOR_ENABLED).toBe("false");
  });
});
