import { createApp } from 'vue';
import App from './App.vue';
import { initializeAuth } from './services/auth';
import './assets/workspace.css';

// Process OIDC callback before Vue Router reads the current URL.
await initializeAuth();
const { default: router } = await import('./router');
createApp(App).use(router).mount('#app');
