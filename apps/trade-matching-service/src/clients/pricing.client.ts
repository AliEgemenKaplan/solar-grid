import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HEADER_CORRELATION_ID, PriceResponseDto } from '@solar-grid/shared-contracts';

@Injectable()
export class PricingClient {
  private readonly logger = new Logger(PricingClient.name);
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = config.get<string>('PRICING_ENGINE_URL', 'http://localhost:3002');
  }

  async getCurrentPrice(correlationId?: string): Promise<PriceResponseDto> {
    const url = `${this.baseUrl}/prices/current`;
    this.logger.debug(`Fetching current price from ${url}`);
    const response = await firstValueFrom(
      this.httpService.get<PriceResponseDto>(url, {
        headers: correlationId ? { [HEADER_CORRELATION_ID]: correlationId } : undefined,
      }),
    );
    return response.data;
  }
}
