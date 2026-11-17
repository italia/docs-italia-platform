// Sito pubblico di Docs Italia: rendering lato server sopra le API dell'istanza.
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // gli URL dei documenti finiscono in ".html" o in "/": niente barra aggiunta o tolta
  trailingSlash: 'ignore',
  server: { host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 4321) },
  vite: { plugins: [tailwindcss()] },
});
