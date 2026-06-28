import { Controller, Get, Param, Query, Res, Logger } from "@nestjs/common";
import { Response } from "express";
import { DistributionApproveService } from "./distribution-approve.service";

@Controller("v1/distribution")
export class DistributionController {
  private readonly logger = new Logger(DistributionController.name);

  constructor(private readonly approveService: DistributionApproveService) {}

  @Get("approve/:slug")
  async approvePack(
    @Param("slug") slug: string,
    @Query("token") token: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.approveService.approvePack(slug, token);

      if ("error" in result) {
        res
          .status(200)
          .send(
            buildSuccessHtml(
              "Already Approved",
              "#888",
              `Pack <strong>${slug}</strong> was already approved.`,
            ),
          );
        return;
      }

      res
        .status(200)
        .send(
          buildSuccessHtml(
            "Pack Approved",
            "#188038",
            `Pack <strong>${slug}</strong> approved.`,
            "It is queued for publishing — the daily publisher will post it to the social channels.",
          ),
        );
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      const status = error.status ?? 500;
      const message = error.message ?? "Unexpected error";
      this.logger.error(`Distribution approval failed for ${slug}: ${message}`);
      res.status(status).send(buildErrorHtml(slug, message));
    }
  }

  @Get("reject/:slug")
  async rejectPack(
    @Param("slug") slug: string,
    @Query("token") token: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.approveService.rejectPack(slug, token);

      if ("error" in result) {
        res
          .status(200)
          .send(
            buildSuccessHtml(
              "Already Rejected",
              "#888",
              `Pack <strong>${slug}</strong> was already marked for revision.`,
            ),
          );
        return;
      }

      res
        .status(200)
        .send(
          buildSuccessHtml(
            "Pack Marked for Revision",
            "#e37400",
            `Pack <strong>${slug}</strong> marked for revision.`,
          ),
        );
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      const status = error.status ?? 500;
      const message = error.message ?? "Unexpected error";
      this.logger.error(`Distribution rejection failed for ${slug}: ${message}`);
      res.status(status).send(buildErrorHtml(slug, message));
    }
  }
}

// ---------------------------------------------------------------------------
// HTML response builders — mirrors admin.controller.ts buildApprovalHtml style
// ---------------------------------------------------------------------------

function buildSuccessHtml(
  heading: string,
  color: string,
  body: string,
  detail?: string,
): string {
  const detailHtml = detail
    ? `<p style="color:#555;font-size:13px;">${detail}</p>`
    : "";
  return `<!DOCTYPE html><html><body style="font-family:Arial;max-width:600px;margin:60px auto;text-align:center;">
<h2 style="color:${color};">&#10003; ${heading}</h2>
<p>${body}</p>
${detailHtml}
<p style="color:#999;font-size:12px;">You can close this tab.</p>
</body></html>`;
}

function buildErrorHtml(slug: string, message: string): string {
  return `<!DOCTYPE html><html><body style="font-family:Arial;max-width:600px;margin:60px auto;text-align:center;">
<h2 style="color:#c0392b;">&#10007; Action Failed</h2>
<p>Could not process pack <strong>${slug}</strong>.</p>
<p style="color:#555;font-size:13px;">${message}</p>
<p style="color:#999;font-size:12px;">Please contact the team if this was unexpected.</p>
</body></html>`;
}
