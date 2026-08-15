import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { KASUMI_MODE, createKasumiParallax, resolveKasumiMode } from '../../src/lib/kasumi.js';

test('selects parallax only for capable motion-enabled clients', () => {
  assert.equal(resolveKasumiMode(), KASUMI_MODE.PARALLAX);
  assert.equal(resolveKasumiMode({ reducedMotion: true }), KASUMI_MODE.REDUCED);
  assert.equal(resolveKasumiMode({ saveData: true }), KASUMI_MODE.STATIC);
  assert.equal(resolveKasumiMode({ deviceMemory: 2 }), KASUMI_MODE.STATIC);
  assert.equal(resolveKasumiMode({ hardwareConcurrency: 2 }), KASUMI_MODE.PARALLAX);
  assert.equal(resolveKasumiMode({ supportsIntersectionObserver: false }), KASUMI_MODE.STATIC);
});

test('reduced motion stays static without observers, listeners, layout reads, or frames', () => {
  const dom = new JSDOM('<header data-kasumi-header></header>');
  const header = dom.window.document.querySelector('header');
  header.getBoundingClientRect = () => { throw new Error('layout must not be read'); };
  let observerCalls = 0;
  let frameCalls = 0;
  const viewport = {
    matchMedia: () => ({ matches: true }),
    CSS: { supports: () => true },
    IntersectionObserver: class {},
    requestAnimationFrame: () => { frameCalls += 1; },
    addEventListener: () => { throw new Error('listeners must not be installed'); },
  };
  createKasumiParallax({
    root: dom.window.document,
    viewport,
    navigatorObject: {},
    observerFactory: () => { observerCalls += 1; },
  });
  assert.equal(header.dataset.kasumiMode, KASUMI_MODE.REDUCED);
  assert.equal(observerCalls, 0);
  assert.equal(frameCalls, 0);
});

test('observes visibility and coalesces passive scroll work into one animation frame', () => {
  const dom = new JSDOM('<header data-kasumi-header></header>');
  const header = dom.window.document.querySelector('header');
  header.getBoundingClientRect = () => ({ top: -100, height: 400 });
  let observerCallback;
  let scrollHandler;
  let scrollOptions;
  const frames = [];
  const viewport = {
    matchMedia: () => ({ matches: false }),
    CSS: { supports: () => true },
    IntersectionObserver: class {},
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame: () => {},
    addEventListener: (type, listener, options) => { if (type === 'scroll') { scrollHandler = listener; scrollOptions = options; } },
    removeEventListener: (type) => { if (type === 'scroll') scrollHandler = undefined; },
  };
  const dispose = createKasumiParallax({
    root: dom.window.document,
    viewport,
    navigatorObject: { deviceMemory: 8, hardwareConcurrency: 8 },
    observerFactory: (callback) => { observerCallback = callback; return { observe: () => {}, disconnect: () => {} }; },
  });
  assert.equal(header.dataset.kasumiMode, KASUMI_MODE.PARALLAX);
  assert.equal(scrollHandler, undefined);
  observerCallback([{ target: header, isIntersecting: true }]);
  assert.equal(header.dataset.kasumiActive, 'true');
  assert.deepEqual(scrollOptions, { passive: true });
  scrollHandler();
  scrollHandler();
  assert.equal(frames.length, 1);
  frames[0]();
  assert.equal(header.style.getPropertyValue('--kasumi-far-shift'), '6.00px');
  assert.equal(header.style.getPropertyValue('--kasumi-near-shift'), '16.00px');
  observerCallback([{ target: header, isIntersecting: false }]);
  assert.equal(header.dataset.kasumiActive, 'false');
  assert.equal(scrollHandler, undefined);
  dispose();
});
