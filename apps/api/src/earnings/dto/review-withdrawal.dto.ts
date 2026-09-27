import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ReviewWithdrawalDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

export class MarkWithdrawalPaidDto {
  @IsString()
  payoutRef!: string;
}
