import { IsIn, IsString, Length } from 'class-validator';

const CATEGORIES = ['chat', 'music', 'gaming', 'talent', 'education', 'other'] as const;

export class GoLiveDto {
  @IsString()
  @Length(1, 80)
  title!: string;

  @IsIn(CATEGORIES)
  category!: (typeof CATEGORIES)[number];
}
