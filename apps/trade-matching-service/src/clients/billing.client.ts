import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { isAxiosError } from 'axios';
import { CompletedTradeDto, HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';

/** What billing-ledger-service returns from POST /trades. */
export interface CreateTradeResponse {
  tradeId: string;
  duplicate: boolean;
}

/**
 * Billing gave a definite "no". Retrying cannot change the answer, so the
 * caller should release the energy it reserved.
 *
 * Every other failure - a timeout, a 5xx, a dropped connection - leaves the
 * outcome unknown: billing may well have recorded the trade before we lost
 * the answer, so the trade has to be retried with the same idempotency key
 * instead of being written off.
 */
export class BillingRejectedError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BillingRejectedError';
  }
}

@Injectable()
export class BillingClient {
  private readonly logger = new Logger(BillingClient.name);
  private readonly baseUrl: string;
  private readonly internalToken: string | undefined;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('BILLING_LEDGER_URL', 'http://localhost:3004');
    // Recording a trade moves money, so billing only accepts it from another
    // Solar Grid service. The token is sent, never logged.
    this.internalToken = config.get<string>('INTERNAL_API_TOKEN');
    if (!this.internalToken) {
      this.logger.warn({
        event: 'config.warning',
        message: 'INTERNAL_API_TOKEN is not set: billing will refuse every trade.',
      });
    }
  }

  async createTrade(dto: CompletedTradeDto): Promise<CreateTradeResponse> {
    const url = `${this.baseUrl}/trades`;

    try {
      const response = await firstValueFrom(
        this.httpService.post<CreateTradeResponse>(url, dto, {
          headers: {
            [HEADER_CORRELATION_ID]: dto.correlationId,
            ...(this.internalToken ? { Authorization: `Bearer ${this.internalToken}` } : {}),
          },
        }),
      );
      return response.data;
    } catch (err) {
      const status = isAxiosError(err) ? err.response?.status : undefined;
      if (status !== undefined && status >= 400 && status < 500) {
        throw new BillingRejectedError(status, `billing rejected the trade with HTTP ${status}`);
      }
      throw err;
    }
  }
}
