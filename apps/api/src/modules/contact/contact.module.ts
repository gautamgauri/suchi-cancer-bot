import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { ContactController } from "./contact.controller";
import { ContactRateLimiter } from "./contact-rate-limiter";
import { ContactService } from "./contact.service";

@Module({
  imports: [EmailModule],
  controllers: [ContactController],
  providers: [ContactService, { provide: ContactRateLimiter, useFactory: () => new ContactRateLimiter() }],
})
export class ContactModule {}
