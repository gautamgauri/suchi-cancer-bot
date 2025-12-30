import { Module } from "@nestjs/common";
import { YoutubeController } from "./youtube.controller";
import { YoutubeService } from "./youtube.service";
import { KbService } from "./kb.service";

@Module({
  controllers: [YoutubeController],
  providers: [YoutubeService, KbService]
})
export class YoutubeModule {}
