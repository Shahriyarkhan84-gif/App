import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';

import { signupCountryFrom } from '../regions/regions.service';

import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RequestOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { AppleLoginDto, GoogleLoginDto } from './dto/social-login.dto';
import { TwoFactorCodeDto, VerifyLoginTwoFactorDto } from './dto/two-factor.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { JwtPayload } from './jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // New accounts record the country they signed up from (edge geo header, else
  // the device region); it decides their pricing region and never changes.
  @Post('register')
  register(@Body() dto: RegisterDto, @Headers() headers: Record<string, string>) {
    return this.auth.register(dto, signupCountryFrom(headers, dto.region));
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@CurrentUser() user: JwtPayload) {
    return this.auth.logout(user.sub);
  }

  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto, @Headers() headers: Record<string, string>) {
    return this.auth.verifyOtp(dto.phone, dto.code, signupCountryFrom(headers, dto.region));
  }

  @Post('google')
  google(@Body() dto: GoogleLoginDto, @Headers() headers: Record<string, string>) {
    return this.auth.googleLogin(dto.idToken, signupCountryFrom(headers, dto.region));
  }

  @Post('apple')
  apple(@Body() dto: AppleLoginDto, @Headers() headers: Record<string, string>) {
    return this.auth.appleLogin(dto.identityToken, dto.displayName, signupCountryFrom(headers, dto.region));
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser() user: JwtPayload) {
    return this.auth.setupTwoFactor(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  enableTwoFactor(@CurrentUser() user: JwtPayload, @Body() dto: TwoFactorCodeDto) {
    return this.auth.enableTwoFactor(user.sub, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  disableTwoFactor(@CurrentUser() user: JwtPayload, @Body() dto: TwoFactorCodeDto) {
    return this.auth.disableTwoFactor(user.sub, dto.code);
  }

  @Post('2fa/verify-login')
  verifyLoginTwoFactor(@Body() dto: VerifyLoginTwoFactorDto) {
    return this.auth.verifyLoginTwoFactor(dto.challenge, dto.code);
  }
}
