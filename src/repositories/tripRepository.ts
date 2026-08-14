import Dexie, { type EntityTable } from 'dexie';

interface TripRecord { id: string; value: unknown; updatedAt: string }

export class TripRepository extends Dexie {
  trips!: EntityTable<TripRecord, 'id'>;

  constructor(name = 'travel-app') {
    super(name);
    // This is deliberately identical to the pre-Vue IndexedDB store and record shape.
    this.version(1).stores({ trips: 'id' });
  }

  async atomicReplace(id: string, candidate: unknown, validate: (value: unknown) => boolean): Promise<void> {
    if (!validate(candidate)) throw new Error('Migration validation failed; existing data was not changed.');
    await this.transaction('rw', this.trips, async () => {
      await this.trips.put({ id, value: structuredClone(candidate), updatedAt: new Date().toISOString() });
    });
  }
}
