/** Immagini e file allegati del documento, dal pacchetto pubblicato. */
import type { APIRoute } from 'astro';
import { api } from '../../../../../../../lib/api';

export const GET: APIRoute = async ({ params }) => {
  const { pub, proj, doc, lang, ver, path } = params as Record<string, string>;
  try {
    const f = await api.file(pub, proj, doc, lang, ver, `assets/${path}`, undefined, 'bytes');
    return new Response(f.body, { headers: { 'content-type': f.type, 'cache-control': 'public, max-age=300' } });
  } catch {
    return new Response('File non trovato', { status: 404 });
  }
};
