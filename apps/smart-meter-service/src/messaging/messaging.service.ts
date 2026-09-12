import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  EnergySurplusDetectedEvent,
  EnergyDemandDetectedEvent,
  EXCHANGE_SOLAR_GRID_ENERGY,
  ROUTING_KEY_SURPLUS_DETECTED,
  ROUTING_KEY_DEMAND_DETECTED,
} from '@solar-grid/shared-contracts';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(private readonly amqpConnection: AmqpConnection) {}

  async publishSurplusDetected(event: EnergySurplusDetectedEvent): Promise<void> {
    this.logger.log(
      `Publishing EnergySurplusDetected: household=${event.householdId} surplus=${event.surplusKwh}kWh [cid=${event.correlationId}]`,
    );
    await this.amqpConnection.publish(
      EXCHANGE_SOLAR_GRID_ENERGY,
      ROUTING_KEY_SURPLUS_DETECTED,
      event,
    );
  }

  async publishDemandDetected(event: EnergyDemandDetectedEvent): Promise<void> {
    this.logger.log(
      `Publishing EnergyDemandDetected: household=${event.householdId} demand=${event.demandKwh}kWh [cid=${event.correlationId}]`,
    );
    await this.amqpConnection.publish(
      EXCHANGE_SOLAR_GRID_ENERGY,
      ROUTING_KEY_DEMAND_DETECTED,
      event,
    );
  }
}
