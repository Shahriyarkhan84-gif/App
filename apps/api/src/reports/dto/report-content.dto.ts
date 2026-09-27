import { IsIn, IsString, Length } from 'class-validator';

export class ReportContentDto {
  @IsIn(['user', 'room', 'message'])
  targetType!: 'user' | 'room' | 'message';

  @IsString()
  targetId!: string;

  @IsString()
  @Length(3, 500)
  reason!: string;
}
