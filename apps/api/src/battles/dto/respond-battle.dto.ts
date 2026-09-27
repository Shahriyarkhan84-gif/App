import { IsBoolean } from 'class-validator';

export class RespondBattleDto {
  @IsBoolean()
  accept!: boolean;
}
