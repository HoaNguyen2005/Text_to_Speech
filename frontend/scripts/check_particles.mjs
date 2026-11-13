import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';

const require = createRequire(import.meta.url);
const vueUrl = pathToFileURL(join(dirname(require.resolve('vue/package.json')), 'index.mjs')).href;
const helperUrl = new URL('../src/components/vue-bits/floatingLinesLoop.js', import.meta.url).href;
const source = await readFile(new URL('../src/components/vue-bits/Particles.vue', import.meta.url), 'utf8');
const compiled = compileScript(parse(source).descriptor, { id: 'particles-check', inlineTemplate: true }).content
  .replaceAll(/from ['"]vue['"]/g, `from '${vueUrl}'`)
  .replaceAll(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`)
  .replace("from './floatingLinesLoop'", `from '${helperUrl}'`)
  .replace('new WebGLRenderer(', 'new globalThis.TestParticleRenderer(');
const renderers = [], observers = [], frames = new Map();
const pointerHandlers = new Map();
const pointerTarget = {
  addEventListener: (name, handler) => pointerHandlers.set(name, handler),
  removeEventListener: (name, handler) => { if (pointerHandlers.get(name) === handler) pointerHandlers.delete(name); },
};
const advance = time => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); };
let frameId = 0, rejectContext = false;
globalThis.devicePixelRatio = 2;
globalThis.innerWidth = 1280;
globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe(element) { this.element = element; }
  disconnect() { this.disconnected = true; }
};
globalThis.TestParticleRenderer = class {
  constructor() {
    if (rejectContext) throw new Error('WebGL unavailable');
    this.debug = {}; this.renders = 0;
    this.domElement = { addEventListener() {}, removeEventListener() {}, remove: () => { this.removed = true; } };
    renderers.push(this);
  }
  setPixelRatio(value) { this.dpr = value; }
  setSize() { this.blank = true; }
  render(scene) { this.blank = false; this.renders++; this.particles = scene.children[0]; this.geometry = this.particles.geometry; }
  dispose() { this.disposed = true; }
  forceContextLoss() { this.lost = true; }
};
const { default: Particles } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const renderer = createRenderer({
  createElement: () => ({ clientWidth: 900, clientHeight: 220, appendChild() {}, closest: () => pointerTarget, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 220 }) }),
  insert() {}, remove() {}, patchProp() {}, createText: () => ({}), createComment: () => ({}),
  setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null,
});
const props = reactive({ count: 90, paused: true, interactive: true });
let ready = 0, unavailable = 0;
const app = renderer.createApp({ render: () => h(Particles, { ...props, onReady: () => ready++, onUnavailable: () => unavailable++ }) });
app.mount({});
assert.equal(ready, 1);
assert.equal(renderers[0].dpr, 1.25);
assert.equal(frames.size, 0);
for (const [attribute, size] of [['position', 3], ['random', 4], ['color', 3]]) {
  const values = renderers[0].geometry.getAttribute(attribute).array;
  assert.equal(values.length, 90 * size);
  assert.ok(values.every(Number.isFinite));
}
const draws = renderers[0].renders;
observers[0].callback();
assert.equal(renderers[0].renders, draws + 1);
assert.equal(renderers[0].blank, false);
props.paused = false; await nextTick();
assert.equal(frames.size, 1);
pointerHandlers.get('pointermove')({ clientX: 900, clientY: 220, pointerType: 'mouse' });
advance(0); advance(40);
assert.ok(renderers[0].particles.position.x < 0 && renderers[0].particles.position.y > 0);
const displacement = Math.abs(renderers[0].particles.position.x);
pointerHandlers.get('pointerleave')(); advance(80);
assert.ok(Math.abs(renderers[0].particles.position.x) < displacement);
props.paused = true; await nextTick();
assert.equal(frames.size, 0);
props.count = 180; await nextTick();
assert.equal(renderers[1].geometry.getAttribute('position').count, 180);
assert.ok(renderers[0].disposed && renderers[0].lost && renderers[0].removed && observers[0].disconnected);
app.unmount();
assert.ok(renderers[1].disposed && observers[1].disconnected);
assert.equal(pointerHandlers.size, 0);
rejectContext = true;
const fallback = renderer.createApp({ render: () => h(Particles, { onUnavailable: () => unavailable++ }) });
fallback.mount({});
assert.equal(unavailable, 1);
fallback.unmount();
console.log('PASS: particle buffers, DPR cap, resize redraw, pointer response/return, playback, cleanup and unavailable WebGL');
