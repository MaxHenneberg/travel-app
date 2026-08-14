export function useHeavyFeatures() {
  return {
    openMap: () => import('../features/map/MapFeature.vue'),
    openGlobe: () => import('../features/globe/GlobeFallback.vue'),
  };
}
