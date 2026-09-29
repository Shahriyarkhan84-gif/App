import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpsertEventDto {
  @IsString()
  @Length(3, 80)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsIn(['gifting', 'pk_battle'])
  kind!: 'gifting' | 'pk_battle';

  @IsOptional()
  @IsString()
  region?: string;

  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  giftIds?: number[];

  // Validated in EventsService (validRewards) to keep one rule for both stacks.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  rewards?: { role: 'host' | 'gifter'; rank_from: number; rank_to: number; reward: string }[];

  @IsBoolean()
  publish!: boolean;
}
