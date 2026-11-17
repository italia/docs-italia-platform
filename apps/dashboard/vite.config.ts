import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Servita dal server in /dashboard/ (stessa origine dell'API). In sviluppo
// le chiamate /api vanno al server dell'istanza (porta 8080).
export default defineConfig({
  base: '/dashboard/',
  plugins: [react(), tailwindcss()],
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:8080' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
