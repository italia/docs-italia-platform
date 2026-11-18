/**
 * Sitemap del sito: pagine istituzionali, amministrazioni, progetti e tutte le
 * pagine della versione predefinita di ogni documento, con il nome vero della
 * versione (gli URL canonici). Le altre versioni restano raggiungibili ma
 * fuori dalla sitemap, come le versioni ritirate.
 */
import type { APIRoute } from 'astro';
import { api, siteOrigin } from '../lib/api';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');
const STATIC = ['/', '/amministrazioni/', '/che-cos-e-docs-italia/', '/come-pubblicare/', '/note-legali/', '/privacy-policy/', '/cookies-policy/'];

export const GET: APIRoute = async ({ url }) => {
  const origin = siteOrigin(url);
  const [publishers, { documents }] = await Promise.all([api.publishers(), api.sitemap()]);
  const entries: Array<{ loc: string; lastmod?: string }> = STATIC.map((p) => ({ loc: p }));
  for (const p of publishers) entries.push({ loc: `/${enc(p.slug)}/` });
  const projects = new Set<string>();
  for (const d of documents) {
    const project = `/${enc(d.publisher)}/${enc(d.project)}/`;
    if (!projects.has(project)) entries.push({ loc: project });
    projects.add(project);
    const base = `${project}${enc(d.document)}/${enc(d.language)}/${enc(d.version)}/`;
    const lastmod = d.lastmod ? new Date(d.lastmod).toISOString().slice(0, 10) : undefined;
    // la prima pagina è la radice del documento
    d.pages.forEach((slug, i) => entries.push({ loc: i === 0 ? base : `${base}${enc(slug)}.html`, lastmod }));
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `<url><loc>${xml(origin + e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' } });
};
