import { onBeforeUnmount, onMounted } from 'vue';

export function useHeavyFeatures() {
  const openMap = () => import('../features/map/MapFeature.vue');
  const openGlobe = () => import('../features/globe/GlobeFallback.vue');
  const openFeature = (event: Event) => {
    const feature = (event as CustomEvent<string>).detail;
    if (feature === 'route') void openMap();
    if (feature === 'globe') void openGlobe();
  };
  onMounted(() => window.addEventListener('trailbook:feature-open', openFeature));
  onBeforeUnmount(() => window.removeEventListener('trailbook:feature-open', openFeature));
  return { openMap, openGlobe };
}
