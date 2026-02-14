import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { GiftController } from "./gift.controller";
import { GiftService } from "./gift.service";

@Module({
  imports: [PrismaModule],
  controllers: [GiftController],
  providers: [GiftService],
  exports: [GiftService],
})
export class GiftModule {}
