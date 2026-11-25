import { Controller, Get, Res } from "@nestjs/common";
import { Response } from "express";

/**
 * Retired approve and reject links of the standalone distribution pipeline
 * (distribution/). They flipped a queue entry on a GET, with HMAC tokens that
 * never expired and a hard-coded fallback secret, and the publisher they fed
 * (distribution/daily-publisher.ts, browser logins to Instagram and X) was
 * never scheduled. Social posting now runs in apps/api/src/modules/social/.
 * These routes change nothing.
 *
 * NOTE: the app sets a global `v1` prefix (main.ts), so this must NOT repeat it.
 */
@Controller("distribution")
export class DistributionController {
  @Get(["approve/:slug", "reject/:slug"])
  retired(@Res() res: Response): void {
    res.status(410).send(`<!DOCTYPE html><html><body style="font-family:Arial;max-width:600px;margin:60px auto;text-align:center;">
<h2 style="color:#6b7280;">Link retired</h2>
<p>This distribution link is no longer used and nothing was changed. Social posts now arrive in a separate email with a review page.</p>
<p style="color:#999;font-size:12px;">You can close this tab.</p>
</body></html>`);
  }
}
