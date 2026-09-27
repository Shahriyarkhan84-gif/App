import { IsInt, IsString, Length, Max, Min } from 'class-validator';

export class SendGiftDto {
  @IsString()
  roomId!: string;

  @IsInt()
  giftId!: number;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;

  @IsString()
  @Length(8, 100)
  idempotencyKey!: string;
}
