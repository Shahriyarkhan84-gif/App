import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';

import { InternalAuthGuard } from '../common/internal-auth.guard';
import { FailedDto, ProbedDto, ReadyDto, RecordingDto, SubtitlesDto } from './dto/media.dto';
import { MediaService } from './media.service';

/**
 * Media worker callbacks (agents/, WORKER_QUEUES=media) — the NestJS
 * counterpart of the service-role internal_media_* RPCs.
 */
@UseGuards(InternalAuthGuard)
@Controller('internal/media')
export class InternalMediaController {
  constructor(private readonly media: MediaService) {}

  @Post(':id/started')
  started(@Param('id') id: string) {
    return this.media.internalStarted(id);
  }

  @Post(':id/probed')
  probed(@Param('id') id: string, @Body() dto: ProbedDto) {
    return this.media.internalProbed(id, dto.probe);
  }

  @Post(':id/ready')
  ready(@Param('id') id: string, @Body() dto: ReadyDto) {
    return this.media.internalReady(id, dto.playback_path, dto.thumbnail_path ?? null, dto.renditions);
  }

  @Post(':id/failed')
  failed(@Param('id') id: string, @Body() dto: FailedDto) {
    return this.media.internalFailed(id, dto.error);
  }

  @Post(':id/subtitles')
  subtitles(@Param('id') id: string, @Body() dto: SubtitlesDto) {
    return this.media.internalSubtitles(id, dto.tracks ?? null, dto.failed === true);
  }

  /** IVS "Recording End" (EventBridge) → replay into the pipeline. */
  @Post('recordings')
  recording(@Body() dto: RecordingDto) {
    return this.media.internalRegisterRecording(dto.channel_arn, dto.recording_session_id, dto.source_path);
  }
}
