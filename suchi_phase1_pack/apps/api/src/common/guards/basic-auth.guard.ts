import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class BasicAuthGuard implements CanActivate {
  constructor(private readonly cfg: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<any>();
    const header = req.headers?.authorization as string | undefined;
    if (!header || !header.startsWith("Basic ")) throw new UnauthorizedException("Missing Basic auth");
    const [user, pass] = Buffer.from(header.slice(6), "base64").toString("utf-8").split(":");
    const ok = user === this.cfg.get("ADMIN_BASIC_USER") && pass === this.cfg.get("ADMIN_BASIC_PASS");
    if (!ok) throw new UnauthorizedException("Invalid credentials");
    return true;
  }
}
