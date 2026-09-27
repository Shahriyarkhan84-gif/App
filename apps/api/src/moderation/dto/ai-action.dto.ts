import { IsIn, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

const ACTION_TYPES = [
  'warning',
  'temp_restriction',
  'temp_ban',
  'permanent_ban',
  'account_review',
  'freeze_wallet',
  'unfreeze_wallet',
  'note',
] as const;

export class ProposeAiActionDto {
  @IsString()
  agent!: string;

  @IsIn(ACTION_TYPES)
  actionType!: (typeof ACTION_TYPES)[number];

  @IsOptional()
  @IsString()
  targetUserId?: string;

  @IsString()
  rationale!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class HideMessageDto {
  @IsString()
  messageId!: string;

  @IsObject()
  moderation!: Record<string, unknown>;
}
