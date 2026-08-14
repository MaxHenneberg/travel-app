import { mount } from '@vue/test-utils';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { beforeAll, describe, expect, it } from 'vitest';
import GlobeFallback from '../../src/features/globe/GlobeFallback.vue';
import { SCHEMA_VERSION } from '../../src/domain/itinerary';
import { TripRepository } from '../../src/repositories/tripRepository';

beforeAll(() => {
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
  Dexie.dependencies.indexedDB = indexedDB;
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
});

describe('Vue migration boundaries', () => {
  it('keeps the schema-v1 boundary explicit', () => expect(SCHEMA_VERSION).toBe('1.0.0'));

  it('renders the truthful globe fallback as a component', () => {
    expect(mount(GlobeFallback).get('[role="status"]').text()).toContain('not available');
  });

  it('rolls back invalid atomic migrations', async () => {
    const repository = new TripRepository(`migration-${crypto.randomUUID()}`);
    await repository.atomicReplace('trip@1', { title: 'kept' }, () => true);
    await expect(repository.atomicReplace('trip@1', { title: 'invalid' }, () => false)).rejects.toThrow(/not changed/);
    expect((await repository.trips.get('trip@1'))?.value).toEqual({ title: 'kept' });
    repository.close();
  });
});
