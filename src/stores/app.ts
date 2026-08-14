import { defineStore } from 'pinia';

export const useAppStore = defineStore('app', {
  state: () => ({ active: !document.hidden, updateAvailable: false, updating: false, updateStatus: '' }),
  actions: {
    setActive(active: boolean) { this.active = active; },
    showUpdate() { this.updateAvailable = true; this.updateStatus = 'A complete Trailbook update is ready.'; },
    postponeUpdate() { this.updateAvailable = false; this.updateStatus = 'Update postponed. Your current version remains active.'; },
    beginUpdate() { this.updating = true; this.updateStatus = 'Updating Trailbook…'; },
    finishUpdate() { this.updating = false; this.updateAvailable = false; this.updateStatus = 'Trailbook is up to date.'; },
    failUpdate() { this.updating = false; this.updateStatus = 'The update could not be applied. Try again when online.'; },
  },
});
