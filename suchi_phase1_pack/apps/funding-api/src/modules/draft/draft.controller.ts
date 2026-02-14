import { Body, Controller, Post } from "@nestjs/common";
import { DraftNeedStatementDto, DraftEmailDto } from "./dto";
import { DraftService } from "./draft.service";

@Controller("draft")
export class DraftController {
  constructor(private readonly draftService: DraftService) {}

  @Post("need-statement")
  async needStatement(@Body() body: DraftNeedStatementDto) {
    return this.draftService.draftNeedStatement(
      body.context,
      body.userMessage,
      body.chunks,
      body.conversationContext,
      body.approval
    );
  }

  @Post("need-statement/refine")
  async needStatementRefine(@Body() body: DraftNeedStatementDto) {
    return this.draftService.draftNeedStatementRefine(
      body.context,
      body.userMessage,
      body.chunks,
      body.conversationContext,
      body.approval
    );
  }

  @Post("email")
  async draftEmail(@Body() body: DraftEmailDto) {
    return this.draftService.draftEmail(
      body.template,
      body.context,
      body.pipelineContext,
      body.donorProfileSnippet,
      body.chunks,
      body.approval
    );
  }
}
