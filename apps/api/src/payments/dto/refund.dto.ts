import { IsBoolean, IsString, Length } from 'class-validator';

export class RequestRefundDto {
  @IsString()
  paymentId!: string;

  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class ReviewRefundDto {
  @IsBoolean()
  approve!: boolean;
}
