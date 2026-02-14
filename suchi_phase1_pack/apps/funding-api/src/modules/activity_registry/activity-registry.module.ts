import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ActivityRegistryController } from "./activity-registry.controller";
import { ActivityRegistryService } from "./activity-registry.service";

@Module({
  imports: [PrismaModule],
  controllers: [ActivityRegistryController],
  providers: [ActivityRegistryService],
  exports: [ActivityRegistryService],
})
export class ActivityRegistryModule {}
