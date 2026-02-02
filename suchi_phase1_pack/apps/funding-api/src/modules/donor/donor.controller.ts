import { Body, Controller, Post, HttpCode, HttpStatus } from "@nestjs/common";
import { DonorService } from "./donor.service";
import { GenerateProfileDto } from "./donor.dto";

@Controller("donor")
export class DonorController {
  constructor(private readonly donorService: DonorService) {}

  @Post("profile/generate")
  @HttpCode(HttpStatus.OK)
  generateProfile(@Body() body: GenerateProfileDto) {
    return this.donorService.generateProfile(body);
  }
}
