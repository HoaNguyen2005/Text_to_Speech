import { createApp } from 'vue';
import App from './App.vue';
import { initializeAuth } from './services/auth';
import './assets/theme.css';
import './assets/workspace.css';
import { initializeTheme } from './composables/useTheme';
import { initializeLocale, getLocaleTag, translate } from './composables/useLocale';

initializeTheme();
initializeLocale();

// Process OIDC callback before Vue Router reads the current URL.
await initializeAuth();
const { default: router } = await import('./router');
const app = createApp(App);
app.config.globalProperties.$t = translate;
Object.defineProperty(app.config.globalProperties, '$locale', { get: getLocaleTag });
app.use(router).mount('#app');
