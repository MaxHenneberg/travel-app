import { onBeforeUnmount, onMounted } from 'vue';
import { useAppStore } from '../stores/app';

export function useAppLifecycle(): void {
  const store = useAppStore();
  const sync = () => store.setActive(!document.hidden);
  onMounted(() => document.addEventListener('visibilitychange', sync));
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', sync));
}
