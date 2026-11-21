import { createApp, h, ref } from 'vue';
import StudioLines from './components/StudioLines.vue';

// The welcome form belongs to Keycloak. Mount only the decorative scene here.
export function mountLines(layer) {
  const narrow = matchMedia('(max-width: 600px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = ref(narrow.matches), dark = ref(false), paused = ref(document.hidden);
  const enabled = ref(false), failed = ref(false);
  function preferences() {
    compact.value = narrow.matches;
    enabled.value = !reduced.matches;
    dark.value = document.documentElement.dataset.theme === 'dark';
    if (!enabled.value) layer.classList.remove('lines-ready');
  }
  const visibility = () => { paused.value = document.hidden; };
  preferences();
  const theme = new MutationObserver(preferences);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  narrow.addEventListener('change', preferences);
  reduced.addEventListener('change', preferences);
  document.addEventListener('visibilitychange', visibility);
  const app = createApp({ render: () => enabled.value && !failed.value ? h(StudioLines, {
    dark: dark.value, compact: compact.value, paused: paused.value,
    onReady: () => layer.classList.add('lines-ready'),
    onUnavailable: () => { failed.value = true; layer.classList.remove('lines-ready'); }
  }) : null });
  app.mount(layer);
}
