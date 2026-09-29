import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, MaxLength, Min, ValidateNested } from 'class-validator';

export class CreateUploadDto {
  @IsString()
  @Length(1, 100)
  title!: string;

  @IsString()
  @Length(2, 5)
  extension!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(['public', 'unlisted'])
  visibility?: 'public' | 'unlisted';
}

export class UpdateMediaDto {
  @IsString()
  @Length(1, 100)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(['public', 'unlisted'])
  visibility!: 'public' | 'unlisted';
}

export class RemoveMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

// Worker payloads (snake_case to match the agents/ worker and the SQL RPCs).

export class ProbedDto {
  @IsObject()
  probe!: Record<string, unknown>;
}

class RenditionDto {
  @IsString() label!: string;
  @IsInt() @Min(1) width!: number;
  @IsInt() @Min(1) height!: number;
  @IsInt() @Min(1) bitrate_kbps!: number;
  @IsString() codecs!: string;
  @IsIn(['sdr', 'hdr10', 'hlg']) dynamic_range!: 'sdr' | 'hdr10' | 'hlg';
  @IsString() playlist_path!: string;
}

export class ReadyDto {
  @IsString() playback_path!: string;
  @IsOptional() @IsString() thumbnail_path?: string;
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => RenditionDto) renditions!: RenditionDto[];
}

export class FailedDto {
  @IsString() @MaxLength(2000) error!: string;
}

class SubtitleDto {
  @IsString() language!: string;
  @IsString() name!: string;
  @IsBoolean() is_source!: boolean;
  @IsString() vtt_path!: string;
  @IsString() playlist_path!: string;
}

export class SubtitlesDto {
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SubtitleDto) tracks?: SubtitleDto[];
  @IsOptional() @IsBoolean() failed?: boolean;
}

export class RecordingDto {
  @IsString() channel_arn!: string;
  @IsString() recording_session_id!: string;
  @IsString() source_path!: string;
}
