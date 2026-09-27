import { IsString } from 'class-validator';

export class InviteBattleDto {
  @IsString()
  targetRoomId!: string;
}
