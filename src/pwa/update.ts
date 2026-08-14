import { onBeforeUnmount, onMounted } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import { useAppStore } from '../stores/app';

export const UPDATE_EVENT = 'trailbook:pwa-update-available';
const UPDATE_MARKER = 'trailbook-update';
let applyWaitingUpdate: (() => Promise<void>) | undefined;

export function clearPwaUpdateMarker(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(UPDATE_MARKER)) return;
  url.searchParams.delete(UPDATE_MARKER);
  url.pathname = import.meta.env.BASE_URL;
  window.history.replaceState(window.history.state, '', url);
}

async function activateAndReload(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.waiting) throw new Error('No waiting service worker is available.');
  const waiting = registration.waiting;
  await new Promise<void>((_resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', controlled);
      reject(new Error('The waiting service worker did not activate.'));
    }, 10_000);
    const controlled = () => {
      window.clearTimeout(timeout);
      const target = new URL(window.location.href);
      target.pathname = `${import.meta.env.BASE_URL}index.html`;
      target.searchParams.set(UPDATE_MARKER, Date.now().toString(36));
      window.location.replace(target.href);
    };
    navigator.serviceWorker.addEventListener('controllerchange', controlled, { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });
}

export function registerPwaUpdates(): void {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT, {
        detail: { update: activateAndReload },
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
