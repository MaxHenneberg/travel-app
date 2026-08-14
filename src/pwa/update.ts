import { onBeforeUnmount, onMounted } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import { useAppStore } from '../stores/app';

export const UPDATE_EVENT = 'trailbook:pwa-update-available';
let applyWaitingUpdate: (() => Promise<void>) | undefined;

export function registerPwaUpdates(): void {
  let updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {
        detail: { update: () => updateServiceWorker(true) },
      }));
    },
  });
}

export function usePwaUpdatePrompt(): void {
  const store = useAppStore();
  const available = (event: Event) => {
    applyWaitingUpdate = (event as CustomEvent<{ update?: () => Promise<void> }>).detail?.update;
    store.showUpdate();
  };
  onMounted(() => window.addEventListener(UPDATE_EVENT, available));
  onBeforeUnmount(() => window.removeEventListener(UPDATE_EVENT, available));
}

export async function requestPwaUpdate(): Promise<void> {
  if (!applyWaitingUpdate) throw new Error('No waiting service worker is available.');
  await applyWaitingUpdate();
}
