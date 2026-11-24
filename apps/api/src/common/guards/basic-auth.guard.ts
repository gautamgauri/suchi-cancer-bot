import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "node:crypto";

/**
 * Equal strings, compared in constant time. Both sides are hashed first, so
 * neither the content nor the length of the expected value leaks through
 * timing. An unset expected value never matches.
 */
function safeEqual(given: string, expected: unknown): boolean {
  if (typeof expected !== "string" || expected === "") return false;
  const a = crypto.createHash("sha256").update(given, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

@Injectable()
export class BasicAuthGuard implements CanActivate {
  constructor(private readonly cfg: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<any>();
    const header = req.headers?.authorization as string | undefined;
    if (!header || !header.startsWith("Basic ")) throw new UnauthorizedException("Missing Basic auth");
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
    // Split on the FIRST colon only (RFC 7617): a user name has none, and a
    // password may contain any number.
    const sep = decoded.indexOf(":");
    const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
    const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
    // Both comparisons always run, so the time taken does not show which failed.
    const userOk = safeEqual(user, this.cfg.get("ADMIN_BASIC_USER"));
    const passOk = safeEqual(pass, this.cfg.get("ADMIN_BASIC_PASS"));
    if (!(userOk && passOk)) throw new UnauthorizedException("Invalid credentials");
    return true;
  }
}
