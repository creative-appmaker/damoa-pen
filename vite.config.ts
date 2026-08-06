import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const CAPACITOR_EXTERNALS = [
  '@capacitor/core',
  '@capacitor/filesystem',
  '@capacitor-mlkit/text-recognition',
];

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      exclude: CAPACITOR_EXTERNALS,
    },
    build: {
      rollupOptions: {
        external: CAPACITOR_EXTERNALS,
      },
    },
  };
});
