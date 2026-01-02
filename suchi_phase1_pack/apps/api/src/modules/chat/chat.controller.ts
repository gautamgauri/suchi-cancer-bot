import { Body, Controller, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ChatDto } from "./dto";
import { ChatService } from "./chat.service";

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60 } })
  async send(@Body() dto: ChatDto) {
    // #region agent log
    const fs = require('fs');
    const logPath = 'c:\\Users\\gauta\\OneDrive\\Documents\\suchi_phase1_pack\\.cursor\\debug.log';
    try { fs.appendFileSync(logPath, JSON.stringify({location:'chat.controller.ts:11',message:'Controller send entry',data:{sessionId:dto.sessionId,userText:dto.userText?.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2,H3,H4,H5'})+'\n'); } catch(e) {}
    // #endregion
    try {
      const result = await this.chat.handle(dto);
      // #region agent log
      try { fs.appendFileSync(logPath, JSON.stringify({location:'chat.controller.ts:16',message:'Controller returning result',data:{messageId:result.messageId,hasResponseText:!!result.responseText,responseTextLength:result.responseText?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1,H6'})+'\n'); } catch(e) {}
      // #endregion
      return result;
    } catch (error: any) {
      // #region agent log
      try { fs.appendFileSync(logPath, JSON.stringify({location:'chat.controller.ts:20',message:'Controller error',data:{errorMessage:error?.message,errorStatus:error?.status,errorName:error?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3,H5'})+'\n'); } catch(e) {}
      // #endregion
      throw error;
    }
  }
}
