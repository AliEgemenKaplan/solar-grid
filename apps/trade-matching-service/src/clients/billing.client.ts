import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { CompletedTradeDto, HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';

/** What billing-ledger-service returns from POST /trades. */
export interface CreateTradeResponse {
  tradeId: string;
  duplicate: boolean;
}

@Injectable()
export class BillingClient {
  private readonly logger = new Logger(BillingClient.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('BILLING_LEDGER_URL', 'http://localhost:3004');
  }

  async createTrade(dto: CompletedTradeDto): Promise<CreateTradeResponse> {
    const url = `${this.baseUrl}/trades`;
    this.logger.debug(
      `Sending trade to billing: tradeId=${dto.tradeId} [cid=${dto.correlationId}]`,
    );
    const response = await firstValueFrom(
      this.httpService.post<CreateTradeResponse>(url, dto, {
        headers: { [HEADER_CORRELATION_ID]: dto.correlationId },
      }),
    );
    return response.data;
  }
}
