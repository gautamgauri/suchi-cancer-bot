import { Module } from "@nestjs/common";
import { EvidenceGateService } from "./evidence-gate.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [EvidenceGateService],
  exports: [EvidenceGateService]
})
export class EvidenceGateModule {}










