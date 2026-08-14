import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

function repositoryBase(value = '/travel-app/'): string {
  const clean = value.trim().replace(/^\/+|\/+$/g, '');
  return clean ? `/${clean}/` : '/';
}

export default defineConfig({
  base: repositoryBase(process.env.BASE_PATH),
  plugins: [
    vue(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'service-worker.ts',
      injectRegister: false,
      injectManifest: { globPatterns: ['**/*.{js,css,html,json,svg,png}'] },
      manifest: false,
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
