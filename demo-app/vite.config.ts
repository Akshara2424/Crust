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
      '/api': {
        target:      'http://localhost:3000',
        changeOrigin: true,
      },
      '/crust.js': {
        target:      'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
