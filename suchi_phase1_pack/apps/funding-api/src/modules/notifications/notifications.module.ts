import { Module, Global } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AuditTrailService } from "./audit-trail.service";
import { EmailNotificationService } from "./email-notification.service";
import { GovernanceDeliveryGuard } from "./governance-delivery.guard";

/**
 * Notifications module for sending generated content to review recipients
 * and persisting governance write audit trail.
 * Marked as Global so it can be injected anywhere without explicit imports.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [EmailNotificationService, GovernanceDeliveryGuard, AuditTrailService],
  exports: [EmailNotificationService, GovernanceDeliveryGuard, AuditTrailService],
})
export class NotificationsModule {}
