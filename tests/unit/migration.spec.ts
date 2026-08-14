import { mount } from '@vue/test-utils';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { createPinia, setActivePinia } from 'pinia';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import GlobeFallback from '../../src/features/globe/GlobeFallback.vue';
import UpdatePrompt from '../../src/app/UpdatePrompt.vue';
import { SCHEMA_VERSION } from '../../src/domain/itinerary';
import { TripRepository } from '../../src/repositories/tripRepository';
import { useAppStore } from '../../src/stores/app';

beforeAll(() => {
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
  Dexie.dependencies.indexedDB = indexedDB;
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
});

beforeEach(() => setActivePinia(createPinia()));

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

  it('postpones an update without activating it and restores focus', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger); trigger.focus();
    const applyUpdate = vi.fn(async () => undefined);
    const wrapper = mount(UpdatePrompt, { attachTo: document.body, props: { applyUpdate } });
    useAppStore().showUpdate();
    await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Update now'));
    await wrapper.get('button:last-of-type').trigger('click');
    expect(applyUpdate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    wrapper.unmount(); trigger.remove();
  });

  it('activates a waiting update only after Update now confirmation', async () => {
    const applyUpdate = vi.fn(async () => undefined);
    const wrapper = mount(UpdatePrompt, { props: { applyUpdate } });
    const store = useAppStore(); store.showUpdate();
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-update-now]').trigger('click');
    expect(applyUpdate).toHaveBeenCalledOnce();
    expect(store.updateAvailable).toBe(false);
    expect(store.updateStatus).toContain('up to date');
  });
});
