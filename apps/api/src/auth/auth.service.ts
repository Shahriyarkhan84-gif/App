import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import appleSignin from 'apple-signin-auth';
import * as argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { JwtPayload } from './jwt.strategy';
import { SMS_PROVIDER, type SmsProvider } from './sms-provider';

export type TokenPair = { accessToken: string; refreshToken: string };

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
        wallet: { create: {} },
      },
    });
    return this.issueTokenPair(user.id, user.role);
  }

  async login(dto: LoginDto): Promise<TokenPair | { twoFactorRequired: true; challenge: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.twoFactorEnabled) {
      // The client must call /auth/2fa/verify-login with this challenge + a TOTP code.
      const challenge = this.jwt.sign(
        { sub: user.id, step: '2fa' },
        { secret: this.config.getOrThrow<string>('JWT_SECRET'), expiresIn: '5m' },
      );
      return { twoFactorRequired: true, challenge };
    }
    return this.issueTokenPair(user.id, user.role);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: JwtPayload & { sub: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.refreshTokenHash || !(await argon2.verify(user.refreshTokenHash, refreshToken))) {
      throw new UnauthorizedException('Refresh token revoked');
    }
    return this.issueTokenPair(user.id, user.role);
  }

  async logout(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null } });
    return { ok: true };
  }

  async issueTokenPair(userId: string, role: string): Promise<TokenPair> {
    const accessToken = this.jwt.sign(
      { sub: userId, role },
      { secret: this.config.getOrThrow<string>('JWT_SECRET'), expiresIn: '15m' },
    );
    const refreshToken = this.jwt.sign(
      { sub: userId, role },
      { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn: '30d' },
    );
    const refreshTokenHash = await argon2.hash(refreshToken);
    await this.prisma.user.update({ where: { id: userId }, data: { refreshTokenHash } });
    return { accessToken, refreshToken };
  }

  async userById(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    return user;
  }

  async requestOtp(phone: string) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await argon2.hash(code);
    await this.prisma.phoneOtp.create({
      data: { phone, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000) },
    });
    await this.sms.send(phone, `Your Zynalive code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`);
    return { ok: true };
  }

  async verifyOtp(phone: string, code: string): Promise<TokenPair> {
    const otp = await this.prisma.phoneOtp.findFirst({
      where: { phone, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw new UnauthorizedException('Code expired or invalid');

    const valid = await argon2.verify(otp.codeHash, code);
    if (!valid) {
      await this.prisma.phoneOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('Incorrect code');
    }
    await this.prisma.phoneOtp.deleteMany({ where: { phone } });

    const user = await this.prisma.user.upsert({
      where: { phone },
      create: { phone, wallet: { create: {} } },
      update: {},
    });
    return this.issueTokenPair(user.id, user.role);
  }

  async googleLogin(idToken: string): Promise<TokenPair> {
    const clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const client = new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }
    if (!payload?.sub) throw new UnauthorizedException('Invalid Google token');

    const user = await this.prisma.user.upsert({
      where: { googleSub: payload.sub },
      create: {
        googleSub: payload.sub,
        email: payload.email,
        displayName: payload.name,
        avatarUrl: payload.picture,
        wallet: { create: {} },
      },
      update: {},
    });
    return this.issueTokenPair(user.id, user.role);
  }

  async appleLogin(identityToken: string, displayName?: string): Promise<TokenPair> {
    let payload;
    try {
      payload = await appleSignin.verifyIdToken(identityToken, {
        audience: this.config.getOrThrow<string>('APPLE_CLIENT_ID'),
      });
    } catch {
      throw new UnauthorizedException('Invalid Apple token');
    }

    const user = await this.prisma.user.upsert({
      where: { appleSub: payload.sub },
      create: {
        appleSub: payload.sub,
        email: payload.email,
        displayName,
        wallet: { create: {} },
      },
      update: {},
    });
    return this.issueTokenPair(user.id, user.role);
  }

  /** Starts enrollment: returns a fresh secret + scannable QR, not yet enabled. */
  async setupTwoFactor(userId: string) {
    const user = await this.userById(userId);
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });
    const otpauth = authenticator.keyuri(user.email ?? user.phone ?? userId, 'Zynalive', secret);
    return { secret, qrCodeDataUrl: await QRCode.toDataURL(otpauth) };
  }

  /** Confirms enrollment with one valid code, then flips 2FA on. */
  async enableTwoFactor(userId: string, code: string) {
    const user = await this.userById(userId);
    if (!user.twoFactorSecret || !authenticator.check(code, user.twoFactorSecret)) {
      throw new UnauthorizedException('Incorrect code');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
    return { ok: true };
  }

  async disableTwoFactor(userId: string, code: string) {
    const user = await this.userById(userId);
    if (!user.twoFactorSecret || !authenticator.check(code, user.twoFactorSecret)) {
      throw new UnauthorizedException('Incorrect code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    return { ok: true };
  }

  /** Second step of login() when the account has 2FA enabled. */
  async verifyLoginTwoFactor(challenge: string, code: string): Promise<TokenPair> {
    let payload: { sub: string; step: string };
    try {
      payload = this.jwt.verify(challenge, { secret: this.config.getOrThrow<string>('JWT_SECRET') });
    } catch {
      throw new UnauthorizedException('Challenge expired');
    }
    if (payload.step !== '2fa') throw new UnauthorizedException('Invalid challenge');

    const user = await this.userById(payload.sub);
    if (!user.twoFactorSecret || !authenticator.check(code, user.twoFactorSecret)) {
      throw new UnauthorizedException('Incorrect code');
    }
    return this.issueTokenPair(user.id, user.role);
  }
}
