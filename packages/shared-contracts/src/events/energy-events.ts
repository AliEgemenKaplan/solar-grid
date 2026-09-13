import { EnergyEventType } from '../enums/energy-event-type.enum';

/**
 * Energy amounts travel as fixed-scale decimal strings ("7.000"), not JSON
 * numbers. A double cannot hold every decimal exactly, and these values are
 * multiplied by a price further down the line.
 */
export interface EnergySurplusDetectedEvent {
  eventId: string;
  eventType: EnergyEventType.EnergySurplusDetected;
  correlationId: string;
  householdId: string;
  /** kWh, 3 decimals. */
  productionKwh: string;
  consumptionKwh: string;
  surplusKwh: string;
  timestamp: string;
}

export interface EnergyDemandDetectedEvent {
  eventId: string;
  eventType: EnergyEventType.EnergyDemandDetected;
  correlationId: string;
  householdId: string;
  /** kWh, 3 decimals. */
  productionKwh: string;
  consumptionKwh: string;
  demandKwh: string;
  timestamp: string;
}

export type EnergyEvent = EnergySurplusDetectedEvent | EnergyDemandDetectedEvent;
