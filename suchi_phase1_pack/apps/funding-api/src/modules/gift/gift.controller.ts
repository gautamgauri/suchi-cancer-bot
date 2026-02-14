import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from "@nestjs/common";
import { GiftService } from "./gift.service";
import { CreateGiftDto } from "./gift.dto";

@Controller("gifts")
export class GiftController {
  constructor(private readonly giftService: GiftService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: CreateGiftDto) {
    return this.giftService.create(body);
  }

  @Get("missing-bank-match")
  getMissingBankMatch(
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.giftService.findMissingBankMatch(limit);
  }

  @Get("by-fy")
  getByFy(@Query("fy") fy: string) {
    if (!fy?.trim()) {
      return { fy: null, gifts: [], count: 0, total: 0 };
    }
    return this.giftService.findByFy(fy.trim());
  }

  @Get("10bd-blocking")
  get10BdBlocking(
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.giftService.get10BdBlockingGifts(limit);
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.giftService.getById(id);
  }
}
