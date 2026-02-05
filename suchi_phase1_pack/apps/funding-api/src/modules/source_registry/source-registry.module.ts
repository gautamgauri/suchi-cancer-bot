import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SourceRegistryController } from "./source-registry.controller";
import { SourceRegistryService } from "./source-registry.service";

@Module({
  imports: [PrismaModule],
  controllers: [SourceRegistryController],
  providers: [SourceRegistryService],
  exports: [SourceRegistryService],
})
export class SourceRegistryModule {}
