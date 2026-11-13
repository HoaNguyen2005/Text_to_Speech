import assert from 'node:assert/strict';
import { createRenderer, h, ref } from 'vue';
import { useSceneMotion } from '../src/composables/useSceneMotion.js';

const listeners = new Map();
globalThis.document = {
  hidden: false,
  addEventListener: (name, handler) => listeners.set(name, handler),
  removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
};
let observer;
globalThis.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; observer = this; }
  observe(element) { this.element = element; }
  disconnect() { this.disconnected = true; }
};
const renderer = createRenderer({
  createElement: () => ({}), insert() {}, remove() {}, patchProp() {},
  createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {},
  parentNode: () => null, nextSibling: () => null,
});
let paused;
function mount() {
  const app = renderer.createApp({ setup() {
    const scene = ref(null);
    paused = useSceneMotion(scene);
    return () => h('section', { ref: scene });
  } });
  app.mount({});
  return app;
}
const app = mount();
assert.ok(observer.element);
assert.equal(paused.value, false);
observer.callback([{ isIntersecting: false }]);
assert.equal(paused.value, true);
document.hidden = true;
observer.callback([{ isIntersecting: true }]);
assert.equal(paused.value, true);
document.hidden = false;
listeners.get('visibilitychange')();
assert.equal(paused.value, false);
app.unmount();
assert.ok(observer.disconnected);
assert.equal(listeners.size, 0);
delete globalThis.IntersectionObserver;
document.hidden = true;
const fallback = mount();
assert.equal(paused.value, true);
document.hidden = false;
listeners.get('visibilitychange')();
assert.equal(paused.value, false);
fallback.unmount();
assert.equal(listeners.size, 0);
console.log('PASS: offscreen/hidden pause, visible resume, observer/listener cleanup, unsupported-browser fallback');
