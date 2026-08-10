import { defineConfig } from 'vite';

function repositoryBase(value = '/travel-app/') {
  const clean = value.trim().replace(/^\/+|\/+$/g, '');
  return clean ? `/${clean}/` : '/';
}

export default defineConfig({
  base: repositoryBase(process.env.BASE_PATH),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
