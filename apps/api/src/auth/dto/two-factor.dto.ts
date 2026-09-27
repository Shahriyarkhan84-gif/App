import { IsString, Length } from 'class-validator';

export class TwoFactorCodeDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class VerifyLoginTwoFactorDto {
  @IsString()
  challenge!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
