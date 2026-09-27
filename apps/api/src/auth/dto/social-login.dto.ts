import { IsOptional, IsString } from 'class-validator';

export class GoogleLoginDto {
  @IsString()
  idToken!: string;
}

export class AppleLoginDto {
  @IsString()
  identityToken!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}
