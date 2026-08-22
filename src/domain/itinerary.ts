export const SCHEMA_VERSION = '1.1.0' as const;

export interface StopV11 { id: string; type: 'stop'; title: string; startsAt?: string; time?: string; location?: string; lat?: number; lng?: number }
export interface TransitV11 { id: string; type: 'transit'; title: string; fromStopId: string; toStopId: string; mode: string }
export interface DayV11 { id: string; date: string; title?: string; items: Array<StopV11 | TransitV11> }
export interface CanonicalItineraryV11 {
  schemaVersion: typeof SCHEMA_VERSION;
  trip: { id: string; title: string; startDate: string; endDate: string; timeZone: string; days: DayV11[] };
}
export type UntrustedItinerary = unknown;
export type PersistedItinerary = Readonly<CanonicalItineraryV11>;
