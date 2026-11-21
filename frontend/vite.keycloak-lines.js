import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Keycloak serves its theme as self-contained static files, including in Docker.
export default defineConfig({
  plugins: [vue()],
  define: { 'process.env.NODE_ENV': '"production"' },
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('../keycloak/themes/text2speech/login/resources/studio-lines/', import.meta.url)),
    emptyOutDir: false,
    minify: true,
    license: true,
    lib: { entry: 'src/keycloak-lines.js', formats: ['es'], fileName: () => 'scene.js', cssFileName: 'scene' },
    rollupOptions: { output: { banner: '/*! Vue Bits Floating Lines\n' + readFileSync(new URL('./src/components/vue-bits/LICENSE.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n') + '\n*/' } }
  }
});
