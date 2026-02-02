import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";

@Injectable()
export class ExportTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>("FUNDING_EXPORT_TOKEN");
    if (!expected) return true; // no token configured → allow (e.g. local dev)
    const request = context.switchToHttp().getRequest<Request>();
    const header =
      request.headers.authorization?.replace(/^Bearer\s+/i, "").trim() ??
      (request.query?.token as string)?.trim();
    if (header !== expected) {
      throw new UnauthorizedException("Invalid or missing export token");
    }
    return true;
  }
}
