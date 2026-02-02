import { Module, Global } from "@nestjs/common";
import { SheetsClientService } from "./sheets-client.service";

@Global()
@Module({
  providers: [SheetsClientService],
  exports: [SheetsClientService],
})
export class SheetsModule {}
