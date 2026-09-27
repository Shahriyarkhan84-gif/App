import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';

import { InternalAuthGuard } from '../common/internal-auth.guard';
import { HideMessageDto, ProposeAiActionDto } from './dto/ai-action.dto';
import { InternalAiModerationDto } from './dto/moderation.dto';
import { ModerationService } from './moderation.service';

/** Only the AI worker (agents/) calls these — see InternalAuthGuard. */
@UseGuards(InternalAuthGuard)
@Controller('internal/moderation')
export class InternalModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Post('ai-moderate')
  aiModerate(@Body() dto: InternalAiModerationDto) {
    return this.moderation.internalAiModeration(dto.targetUserId, dto.action, dto.reason, dto.reportId ?? null);
  }

  @Post('hide-message')
  hideMessage(@Body() dto: HideMessageDto) {
    return this.moderation.internalHideMessage(BigInt(dto.messageId), dto.moderation);
  }

  @Post('ai-actions')
  proposeAiAction(@Body() dto: ProposeAiActionDto) {
    return this.moderation.proposeAiAction(
      dto.agent,
      dto.actionType,
      dto.targetUserId ?? null,
      dto.rationale,
      dto.confidence ?? null,
      dto.params ?? {},
    );
  }

  @Post('ai-actions/:id/execute')
  executeAiAction(@Param('id', ParseIntPipe) id: number) {
    return this.moderation.internalExecuteAiAction(BigInt(id));
  }
}
