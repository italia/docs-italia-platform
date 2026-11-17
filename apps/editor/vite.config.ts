import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In sviluppo le chiamate /api, /files e /sito vanno al server dello studio (porta 4322).
const studio = 'http://127.0.0.1:4322';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': studio, '/files': studio, '/sito': studio } },
  build: { outDir: 'dist', emptyOutDir: true },
});
