import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { GmailClientService } from "./gmail-client.service";
import { GmailIngestService } from "./gmail-ingest.service";

@Module({
  imports: [PrismaModule],
  providers: [GmailClientService, GmailIngestService],
  exports: [GmailClientService, GmailIngestService],
})
export class GmailModule {}
