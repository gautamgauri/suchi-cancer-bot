import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { GoogleSearchModule } from "../google_search/google-search.module";
import { FunderScraperController } from "./funder-scraper.controller";
import { FunderScraperService } from "./funder-scraper.service";
import { ScheduledFunderScraperService } from "./scheduled-funder-scraper.service";

@Module({
  imports: [ConfigModule, PrismaModule, GoogleSearchModule],
  controllers: [FunderScraperController],
  providers: [FunderScraperService, ScheduledFunderScraperService],
  exports: [FunderScraperService],
})
export class FunderScraperModule {}

