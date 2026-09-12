import { EnergyEventType } from '../enums/energy-event-type.enum';

export interface EnergySurplusDetectedEvent {
  eventId: string;
  eventType: EnergyEventType.EnergySurplusDetected;
  correlationId: string;
  householdId: string;
  productionKwh: number;
  consumptionKwh: number;
  surplusKwh: number;
  timestamp: string;
}

export interface EnergyDemandDetectedEvent {
  eventId: string;
  eventType: EnergyEventType.EnergyDemandDetected;
  correlationId: string;
  householdId: string;
  productionKwh: number;
  consumptionKwh: number;
  demandKwh: number;
  timestamp: string;
}

export type EnergyEvent = EnergySurplusDetectedEvent | EnergyDemandDetectedEvent;
