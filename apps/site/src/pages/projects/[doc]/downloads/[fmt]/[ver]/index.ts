/**
 * Vecchi URL dei file scaricabili, come nella piattaforma attuale:
 *   /projects/<documento>/downloads/<pdf|epub|htmlzip>/<versione>/
 */
import type { APIRoute } from 'astro';
import { api } from '../../../../../../lib/api';

const FORMATS: Record<string, { key: string; ext: string }> = {
  pdf: { key: 'pdf', ext: 'pdf' },
  epub: { key: 'epub', ext: 'epub' },
  htmlzip: { key: 'html', ext: 'zip' },
};

export const GET: APIRoute = async ({ params }) => {
  const { doc, fmt, ver } = params as Record<string, string>;
  const format = FORMATS[fmt];
  if (!format) return new Response('Formato non disponibile', { status: 404 });
  try {
    const where = await api.lookup(doc);
    const info = await api.document(where.publisher, where.project, where.document);
    if (info.withdrawn?.some((w) => w.slug === ver)) return new Response('Versione ritirata: non è più disponibile', { status: 410 });
    const manifest = await api.file(where.publisher, where.project, where.document, info.language, ver, 'manifest.json');
    const path: string | undefined = manifest.downloads?.[format.key];
    if (!path) return new Response('Formato non disponibile per questa versione', { status: 404 });
    const f = await api.file(where.publisher, where.project, where.document, info.language, ver, path, undefined, 'bytes');
    return new Response(f.body, {
      headers: {
        'content-type': f.type,
        'content-disposition': `attachment; filename="${where.document}-${ver}.${format.ext}"`,
        'cache-control': 'public, max-age=300',
      },
    });
  } catch {
    return new Response('File non trovato', { status: 404 });
  }
};
