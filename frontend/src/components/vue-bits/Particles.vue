<!-- Adapted from Vue Bits Particles: https://vue-bits.dev/backgrounds/particles
Copyright (c) 2025 David Haz. MIT + Commons Clause; see LICENSE.md.
Local changes: Three.js renderer, bounded animation, resize redraw and lifecycle cleanup. -->
<script setup>
import { BufferAttribute, BufferGeometry, Color, PerspectiveCamera, Points, Scene, ShaderMaterial, Vector2, WebGLRenderer } from 'three';
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import { floatingLinesLoop as animationLoop } from './floatingLinesLoop';

const props = defineProps({ paused: Boolean, interactive: { type: Boolean, default: true }, count: { type: Number, default: 180 }, colors: { type: Array, default: () => ['#ffffff', '#b7e9ff', '#d1c0ff'] } });
const emit = defineEmits(['ready', 'unavailable']);
const container = useTemplateRef('container');
const vertexShader = `
  attribute vec4 random;
  attribute vec3 color;

  uniform float uTime;
  uniform float uSpread;
  uniform float uBaseSize;
  uniform float uSizeRandomness;

  varying vec4 vRandom;
  varying vec3 vColor;

  void main() {
    vRandom = random;
    vColor = color;

    vec3 pos = position * uSpread;
    pos.z *= 10.0;

    vec4 mPos = modelMatrix * vec4(pos, 1.0);
    float t = uTime;
    mPos.x += sin(t * random.z + 6.28 * random.w) * mix(0.1, 1.5, random.x);
    mPos.y += sin(t * random.y + 6.28 * random.x) * mix(0.1, 1.5, random.w);
    mPos.z += sin(t * random.w + 6.28 * random.y) * mix(0.1, 1.5, random.z);

    vec4 mvPos = viewMatrix * mPos;

    if (uSizeRandomness == 0.0) {
      gl_PointSize = uBaseSize;
    } else {
      gl_PointSize = (uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5))) / length(mvPos.xyz);
    }

    gl_Position = projectionMatrix * mvPos;
  }
`;
const fragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform float uAlphaParticles;
  varying vec4 vRandom;
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord.xy;
    float d = length(uv - vec2(0.5));

    if(uAlphaParticles < 0.5) {
      if(d > 0.5) {
        discard;
      }
      gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), 1.0);
    } else {
      float circle = smoothstep(0.5, 0.4, d) * 0.8;
      gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), circle);
    }
  }
`;
let cleanup, updatePlayback;

function setup() {
  const element = container.value;
  if (!element) return;
  let renderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: false, depth: false, premultipliedAlpha: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  } catch { emit('unavailable'); return; }
  const dpr = Math.min(devicePixelRatio || 1, innerWidth <= 600 ? 1 : 1.25);
  renderer.setPixelRatio(dpr);
  element.appendChild(renderer.domElement);
  const scene = new Scene(), camera = new PerspectiveCamera(15, 1, .1, 200);
  camera.position.z = 20;
  const positions = new Float32Array(props.count * 3), randoms = new Float32Array(props.count * 4), colors = new Float32Array(props.count * 3);
  const palette = props.colors.map(hex => new Color(hex).convertLinearToSRGB());
  for (let i = 0; i < props.count; i++) {
    let x, y, z, length;
    do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; length = x*x + y*y + z*z; } while (length > 1 || length === 0);
    const radius = Math.cbrt(Math.random());
    positions.set([x * radius, y * radius, z * radius], i * 3);
    randoms.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    palette[Math.floor(Math.random() * palette.length)].toArray(colors, i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('random', new BufferAttribute(randoms, 4));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const material = new ShaderMaterial({ vertexShader, fragmentShader, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uSpread: { value: 9 }, uBaseSize: { value: 110 * dpr }, uSizeRandomness: { value: 1 }, uAlphaParticles: { value: 1 } }
  });
  const particles = new Points(geometry, material);
  particles.frustumCulled = false;
  scene.add(particles);
  const targetMouse = new Vector2(), mouse = new Vector2();
  const pointerTarget = element.closest('.studio-banner') || element;
  const move = event => {
    if (event.pointerType === 'touch') return;
    const rect = element.getBoundingClientRect();
    targetMouse.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
  };
  const leave = () => targetMouse.set(0, 0);
  if (props.interactive) {
    pointerTarget.addEventListener('pointermove', move, { passive: true });
    pointerTarget.addEventListener('pointerleave', leave);
  }
  const loop = animationLoop(delta => {
    material.uniforms.uTime.value += delta * .24;
    const elapsed = material.uniforms.uTime.value;
    mouse.lerp(targetMouse, 1 - Math.exp(-delta * 6));
    particles.position.set(-mouse.x * 1.4, -mouse.y * .9, 0);
    particles.rotation.set(Math.sin(elapsed * .2) * .1 + mouse.y * .05, Math.cos(elapsed * .5) * .15 + mouse.x * .08, elapsed * .35);
    renderer.render(scene, camera);
  });
  const resize = () => {
    const width = element.clientWidth || 1, height = element.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  let failed = false, disposed = false;
  const fail = () => { failed = true; cleanup?.(); emit('unavailable'); };
  renderer.debug.onShaderError = fail;
  renderer.domElement.addEventListener('webglcontextlost', fail, { once: true });
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  cleanup = () => {
    if (disposed) return;
    disposed = true;
    updatePlayback = undefined;
    loop.stop();
    observer?.disconnect();
    pointerTarget.removeEventListener('pointermove', move);
    pointerTarget.removeEventListener('pointerleave', leave);
    renderer.domElement.removeEventListener('webglcontextlost', fail);
    geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss();
    renderer.domElement.remove();
  };
  resize();
  if (failed) return;
  observer?.observe(element);
  emit('ready');
  updatePlayback = () => { if (props.paused) loop.stop(); else loop.start(); };
  updatePlayback();
}
onMounted(setup);
onBeforeUnmount(() => cleanup?.());
watch(() => props.paused, () => updatePlayback?.());
watch(() => [props.count, props.colors, props.interactive], () => { cleanup?.(); setup(); }, { deep: true });
</script>

<template><div ref="container" class="particles-container" /></template>
<style scoped>
.particles-container { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.particles-container :deep(canvas) { display: block; width: 100%; height: 100%; }
</style>
