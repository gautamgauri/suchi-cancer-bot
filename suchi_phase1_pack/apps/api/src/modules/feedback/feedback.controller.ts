import { Body, Controller, Post } from "@nestjs/common";
import { FeedbackDto } from "./dto";
import { FeedbackService } from "./feedback.service";
@Controller("feedback")
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}
  @Post() async submit(@Body() dto: FeedbackDto) { return this.feedback.submit(dto); }
}
