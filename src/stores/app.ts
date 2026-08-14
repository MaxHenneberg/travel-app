import { defineStore } from 'pinia';

export const useAppStore = defineStore('app', {
  state: () => ({ active: !document.hidden, updateAvailable: false }),
  actions: { setActive(active: boolean) { this.active = active; } },
});
