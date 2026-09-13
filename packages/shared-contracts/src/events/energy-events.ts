import { EnergyEventType } from '../enums/energy-event-type.enum';

/** Bump when the shape of an event changes in a way consumers must notice. */
export const ENERGY_EVENT_VERSION = 1;

/**
 * Metadata every energy event carries, alongside its domain fields.
 *
 * The envelope is flat rather than nested under a `payload` key: these events
 * have a handful of fields each, and flattening keeps the published JSON, the
 * outbox row and the consumer signature the same shape they already were.
 */
export interface EnergyEventEnvelope {
  /** Unique per event. Consumers deduplicate on this, and it is also sent as the AMQP messageId. */
  eventId: string;
  eventType: EnergyEventType;
  /** Schema version of this event. */
  version: number;
  /** When the event was produced, as opposed to when the meter took its reading. */
  occurredAt: string;
  /** Ties every log line, message and row of one operation together. */
  correlationId: string;
  /** What caused this event: the id of the meter reading it was derived from. */
  sourceEventId: string;
}

/**
 * Energy amounts travel as fixed-scale decimal strings ("7.000"), not JSON
 * numbers. A double cannot hold every decimal exactly, and these values are
 * multiplied by a price further down the line.
 */
export interface EnergySurplusDetectedEvent extends EnergyEventEnvelope {
  eventType: EnergyEventType.EnergySurplusDetected;
  householdId: string;
  /** kWh, 3 decimals. */
  productionKwh: string;
  consumptionKwh: string;
  surplusKwh: string;
  /** When the meter took the reading. */
  timestamp: string;
}

export interface EnergyDemandDetectedEvent extends EnergyEventEnvelope {
  eventType: EnergyEventType.EnergyDemandDetected;
  householdId: string;
  /** kWh, 3 decimals. */
  productionKwh: string;
  consumptionKwh: string;
  demandKwh: string;
  /** When the meter took the reading. */
  timestamp: string;
}

export type EnergyEvent = EnergySurplusDetectedEvent | EnergyDemandDetectedEvent;
