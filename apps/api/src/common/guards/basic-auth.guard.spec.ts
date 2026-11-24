import { UnauthorizedException } from "@nestjs/common";
import * as crypto from "node:crypto";
import { BasicAuthGuard } from "./basic-auth.guard";

jest.mock("node:crypto", () => {
  const actual = jest.requireActual("node:crypto");
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

// Synthetic credentials for this spec only.
const USER = "spec-admin";
const PASS = "spec:pass:with:colons";

function guardWith(env: Record<string, string | undefined>) {
  return new BasicAuthGuard({ get: (k: string) => env[k] } as any);
}

function ctx(authorization?: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }),
  } as any;
}

const basic = (raw: string) => `Basic ${Buffer.from(raw, "utf-8").toString("base64")}`;

describe("BasicAuthGuard", () => {
  const guard = guardWith({ ADMIN_BASIC_USER: USER, ADMIN_BASIC_PASS: PASS });

  it("accepts the right credentials, with a password that contains colons", () => {
    expect(guard.canActivate(ctx(basic(`${USER}:${PASS}`)))).toBe(true);
  });

  it("splits on the first colon only", () => {
    // With a split on every colon the password would read "spec" and fail.
    expect(guard.canActivate(ctx(basic(`${USER}:${PASS}`)))).toBe(true);
    expect(() => guard.canActivate(ctx(basic(`${USER}:spec`)))).toThrow(UnauthorizedException);
  });

  it.each([
    ["no header", undefined],
    ["not Basic", "Bearer x"],
    ["wrong password", basic(`${USER}:nope`)],
    ["wrong user", basic(`someone:${PASS}`)],
    ["no colon", basic(USER)],
    ["password prefix only", basic(`${USER}:spec:pass`)],
  ])("rejects %s", (_name, header) => {
    expect(() => guard.canActivate(ctx(header))).toThrow(UnauthorizedException);
  });

  it("never matches when the credentials are not configured", () => {
    const unset = guardWith({});
    expect(() => unset.canActivate(ctx(basic(":")))).toThrow(UnauthorizedException);
    const empty = guardWith({ ADMIN_BASIC_USER: "", ADMIN_BASIC_PASS: "" });
    expect(() => empty.canActivate(ctx(basic(":")))).toThrow(UnauthorizedException);
  });

  it("compares in constant time", () => {
    const spy = crypto.timingSafeEqual as unknown as jest.Mock;
    spy.mockClear();
    expect(() => guard.canActivate(ctx(basic(`${USER}:nope`)))).toThrow(UnauthorizedException);
    // Both the user and the password comparison run, even when one fails.
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
