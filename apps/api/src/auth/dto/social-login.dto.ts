import { IsOptional, IsString, Matches } from 'class-validator';

export class GoogleLoginDto {
  @IsString()
  idToken!: string;

  // Device region (ISO-2), used only when the edge sends no country header.
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  region?: string;
}

export class AppleLoginDto {
  @IsString()
  identityToken!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  // Device region (ISO-2), used only when the edge sends no country header.
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  region?: string;
}
