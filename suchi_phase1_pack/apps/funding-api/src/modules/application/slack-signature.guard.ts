import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import * as crypto from "crypto";

/**
 * Verifies Slack request signatures using the signing secret.
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * If SLACK_SIGNING_SECRET is not configured, allows all requests (local dev).
 */
@Injectable()
export class SlackSignatureGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const signingSecret = this.configService.get<string>("SLACK_SIGNING_SECRET");
    if (!signingSecret) return true; // no secret configured → allow (local dev)

    const request = context.switchToHttp().getRequest<Request>();
    const timestamp = request.headers["x-slack-request-timestamp"] as string;
    const signature = request.headers["x-slack-signature"] as string;

    if (!timestamp || !signature) {
      throw new UnauthorizedException("Missing Slack signature headers");
    }

    // Protect against replay attacks (reject if >5 minutes old)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > 300) {
      throw new UnauthorizedException("Slack request timestamp too old");
    }

    // Reconstruct the raw body for signature verification
    const rawBody =
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body);
    const sigBasestring = `v0:${timestamp}:${rawBody}`;
    const expectedSignature =
      "v0=" +
      crypto
        .createHmac("sha256", signingSecret)
        .update(sigBasestring, "utf8")
        .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature, "utf8"),
        Buffer.from(expectedSignature, "utf8"),
      )
    ) {
      throw new UnauthorizedException("Invalid Slack signature");
    }

    return true;
  }
}
