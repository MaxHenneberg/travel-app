export const KASUMI_MODE = Object.freeze({
  PARALLAX: 'parallax',
  REDUCED: 'reduced-motion',
  STATIC: 'static-fallback',
});

export function resolveKasumiMode({
  reducedMotion = false,
  saveData = false,
  deviceMemory,
  hardwareConcurrency,
  supportsTransform = true,
  supportsAnimationFrame = true,
  supportsIntersectionObserver = true,
} = {}) {
  if (reducedMotion) return KASUMI_MODE.REDUCED;
  const lowCapability = saveData
    || (Number.isFinite(deviceMemory) && deviceMemory <= 2);
  if (lowCapability || !supportsTransform || !supportsAnimationFrame || !supportsIntersectionObserver) {
    return KASUMI_MODE.STATIC;
  }
  return KASUMI_MODE.PARALLAX;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createKasumiParallax({
  root = document,
  viewport = window,
  navigatorObject = navigator,
  observerFactory = (callback) => new IntersectionObserver(callback, { threshold: 0 }),
} = {}) {
  const stages = [...root.querySelectorAll('[data-kasumi-stage]')];
  if (!stages.length) return () => {};

  const reducedMotion = viewport.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const mode = resolveKasumiMode({
    reducedMotion,
    saveData: navigatorObject.connection?.saveData === true,
    deviceMemory: navigatorObject.deviceMemory,
    hardwareConcurrency: navigatorObject.hardwareConcurrency,
    supportsTransform: typeof viewport.CSS?.supports === 'function'
      && viewport.CSS.supports('transform', 'translate3d(0, 0, 0)'),
    supportsAnimationFrame: typeof viewport.requestAnimationFrame === 'function',
    supportsIntersectionObserver: typeof viewport.IntersectionObserver === 'function',
  });
  stages.forEach((stage) => { stage.dataset.kasumiMode = mode; });
  if (mode !== KASUMI_MODE.PARALLAX) return () => {};

  const visibleStages = new Set();
  let animationFrame = null;
  let listening = false;

  const update = () => {
    animationFrame = null;
    const scrollTop = Number.isFinite(viewport.scrollY) ? viewport.scrollY : (viewport.pageYOffset || 0);
    const travelLimit = Math.min(1200, Math.max(640, viewport.innerHeight || 0));
    const progress = clamp(scrollTop, 0, travelLimit);
    for (const stage of visibleStages) {
      stage.style.setProperty('--kasumi-far-shift', `${(progress * 0.06).toFixed(2)}px`);
      stage.style.setProperty('--kasumi-near-shift', `${(progress * 0.16).toFixed(2)}px`);
    }
  };
  const onScroll = () => {
    if (animationFrame !== null || !visibleStages.size || root.visibilityState === 'hidden') return;
    animationFrame = viewport.requestAnimationFrame(update);
  };
  const syncScrollListener = () => {
    const shouldListen = visibleStages.size > 0 && root.visibilityState !== 'hidden';
    if (shouldListen === listening) return;
    listening = shouldListen;
    if (listening) viewport.addEventListener('scroll', onScroll, { passive: true });
    else viewport.removeEventListener('scroll', onScroll);
  };
  const onVisibilityChange = () => syncScrollListener();
  const observer = observerFactory((entries) => {
    for (const entry of entries) {
      entry.target.dataset.kasumiActive = entry.isIntersecting ? 'true' : 'false';
      if (entry.isIntersecting) visibleStages.add(entry.target);
      else visibleStages.delete(entry.target);
    }
    syncScrollListener();
    onScroll();
  });
  stages.forEach((stage) => observer.observe(stage));
  root.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    observer.disconnect();
    root.removeEventListener('visibilitychange', onVisibilityChange);
    if (listening) viewport.removeEventListener('scroll', onScroll);
    if (animationFrame !== null) viewport.cancelAnimationFrame(animationFrame);
  };
}
