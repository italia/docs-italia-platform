/** robots.txt: tutto indicizzabile tranne la ricerca; indica la sitemap. */
import type { APIRoute } from 'astro';
import { siteOrigin } from '../lib/api';

export const GET: APIRoute = ({ url }) =>
  new Response(`User-agent: *\nDisallow: /ricerca\n\nSitemap: ${siteOrigin(url)}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
