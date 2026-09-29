import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(2)
  displayName!: string;

  // Device region (ISO-2), used only when the edge sends no country header.
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  region?: string;
}
