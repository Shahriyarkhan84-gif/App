import { Injectable, Logger } from '@nestjs/common';

export const SMS_PROVIDER = 'SMS_PROVIDER';

export interface SmsProvider {
  send(phone: string, message: string): Promise<void>;
}

/**
 * Dev/default provider: logs the code instead of sending an SMS. Swap for a
 * Twilio/SNS-backed provider under the same SMS_PROVIDER token when a real
 * account is wired up (see docs/MIGRATION_PLAN.md, Phase 2).
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`SMS to ${phone}: ${message}`);
  }
}
