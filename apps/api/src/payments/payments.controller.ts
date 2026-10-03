import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PLATFORM_ADMIN_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateCheckoutDto } from './dto/checkout.dto';
import { RequestRefundDto, ReviewRefundDto } from './dto/refund.dto';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly stripe: StripeService,
  ) {}

  @Get('packages')
  packages() {
    return this.payments.listPackages();
  }

  @UseGuards(JwtAuthGuard)
  @Get('packages/mine')
  myPackages(@CurrentUser() user: JwtPayload) {
    return this.payments.listPackagesFor(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  async checkout(@CurrentUser() user: JwtPayload, @Body() dto: CreateCheckoutDto) {
    const payment = await this.payments.createPayment(user.sub, dto.packageId);
    const session = await this.stripe.createCheckoutSession(payment);
    await this.payments.attachPaymentRef(payment.id, session.id);
    return { checkoutUrl: session.url, paymentId: payment.id };
  }

  @UseGuards(JwtAuthGuard)
  @Post('refunds')
  requestRefund(@CurrentUser() user: JwtPayload, @Body() dto: RequestRefundDto) {
    return this.payments.requestRefund(user.sub, dto.paymentId, dto.reason);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PLATFORM_ADMIN_ROLES)
  @Post('refunds/:id/review')
  reviewRefund(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ReviewRefundDto) {
    return this.payments.reviewRefund(user.sub, user.role, id, dto.approve);
  }
}
