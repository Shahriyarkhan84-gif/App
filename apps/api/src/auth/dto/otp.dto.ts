import { IsOptional, IsPhoneNumber, IsString, Length, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsPhoneNumber()
  phone!: string;
}

export class VerifyOtpDto {
  @IsPhoneNumber()
  phone!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  // Device region (ISO-2), used only when the edge sends no country header.
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  region?: string;
}
