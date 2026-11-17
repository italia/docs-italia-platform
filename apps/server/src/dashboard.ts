/**
 * La dashboard costruita (apps/dashboard/dist) servita dal server in /dashboard/,
 * così usa la stessa origine dell'API. In sviluppo si usa il server di Vite.
 */
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};

export const DASHBOARD_DIST = process.env.DASHBOARD_DIST ?? fileURLToPath(new URL('../../dashboard/dist/', import.meta.url));

// biome-ignore lint: Hono con variabili diverse
export function serveDashboard(app: Hono<any>, dist = DASHBOARD_DIST): void {
  app.get('/dashboard', (c) => c.redirect('/dashboard/', 301));
  app.get('/dashboard/*', async (c) => {
    if (!existsSync(join(dist, 'index.html'))) {
      return c.text('Dashboard non costruita: bun run build in apps/dashboard (in sviluppo: bun run dev, porta 5174)', 404);
    }
    const rel = decodeURIComponent(c.req.path.slice('/dashboard/'.length)) || 'index.html';
    const file = normalize(join(dist, rel));
    if (!file.startsWith(normalize(dist) + (dist.endsWith(sep) ? '' : sep)) && file !== normalize(dist)) return c.text('percorso non valido', 400);
    // le rotte dell'applicazione sono nel frammento (#/documenti/…): ogni altro percorso è un file
    const target = existsSync(file) && !file.endsWith(sep) ? file : join(dist, 'index.html');
    const immutable = rel.startsWith('assets/');
    return new Response(Bun.file(target), {
      headers: {
        'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    });
  });
}
