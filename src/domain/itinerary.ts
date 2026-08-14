export const SCHEMA_VERSION = '1.0.0' as const;

export interface ActivityV1 { id: string; title: string; startsAt?: string; time?: string }
export interface DayV1 { id: string; date: string; title?: string; activities: ActivityV1[] }
export interface CanonicalItineraryV1 {
  schemaVersion: typeof SCHEMA_VERSION;
  trip: { id: string; title: string; startDate: string; endDate: string; timeZone: string; days: DayV1[] };
}
export type UntrustedItinerary = unknown;
export type PersistedItinerary = Readonly<CanonicalItineraryV1>;
