import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const ACTIONS = ['warning', 'temp_restriction', 'temp_ban', 'permanent_ban', 'content_removal', 'account_review'] as const;

export class ApplyModerationDto {
  @IsString()
  targetUserId!: string;

  @IsIn(ACTIONS)
  action!: (typeof ACTIONS)[number];

  @IsString()
  @Length(1, 2000)
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 90)
  hours?: number;

  @IsOptional()
  @IsString()
  reportId?: string;
}

export class InternalAiModerationDto {
  @IsString()
  targetUserId!: string;

  @IsIn(['warning', 'content_removal'])
  action!: 'warning' | 'content_removal';

  @IsString()
  @Length(1, 2000)
  reason!: string;

  @IsOptional()
  @IsString()
  reportId?: string;
}

export class ReviewAiActionDto {
  @IsIn([true, false])
  approve!: boolean;
}
