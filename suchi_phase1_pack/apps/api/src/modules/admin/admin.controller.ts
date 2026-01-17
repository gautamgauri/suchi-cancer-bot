import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { BasicAuthGuard } from "../../common/guards/basic-auth.guard";
import { AdminService } from "./admin.service";

@UseGuards(BasicAuthGuard)
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get("conversations") async conversations(@Query("from") from?: string, @Query("to") to?: string, @Query("filter") filter?: string) {
    return this.admin.listConversations({ from, to, filter });
  }
  @Get("metrics") async metrics(@Query("from") from?: string, @Query("to") to?: string) { return this.admin.metrics({ from, to }); }
  @Get("kb-stats") async kbStats() { return this.admin.kbStats(); }
}
