import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root:    'frontend',
  plugins: [react()],
  build: {
    outDir:      '../frontend/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // API calls → Express :3000
      '/api': {
        target:       'http://localhost:3000',
        changeOrigin: true,
      },
      // CRUST SDK bundle → Express :3000
      '/crust.js': {
        target:       'http://localhost:3000',
        changeOrigin: true,
      },
      // CRUST Web Worker → Express :3000
      '/dist/crust.worker.js': {
        target:       'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});