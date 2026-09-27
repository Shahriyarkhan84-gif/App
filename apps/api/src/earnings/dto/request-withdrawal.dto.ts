import { Type } from 'class-transformer';
import { IsInt, IsObject, IsPositive } from 'class-validator';

export class RequestWithdrawalDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  coins!: number;

  @IsObject()
  payoutMethod!: { type: string; [key: string]: unknown };
}
