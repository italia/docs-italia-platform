/**
 * Client delle API dell'istanza, con una cache in memoria a scadenza breve.
 * I file dei pacchetti sono immutabili per build: quando l'URL contiene l'id
 * della build si tengono più a lungo.
 */
const API = (process.env.API_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const cache = new Map<string, { until: number; value: unknown }>();

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function get(path: string, ttlMs: number, as: 'json' | 'bytes' = 'json'): Promise<any> {
  const key = `${as}:${path}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new ApiError(res.status, `${path}: ${res.status}`);
  const value = as === 'json' ? await res.json() : { body: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'application/octet-stream' };
  if (cache.size > 2000) cache.clear();
  cache.set(key, { until: Date.now() + ttlMs, value });
  return value;
}

const enc = (s: string) => encodeURIComponent(s);
const docPath = (pub: string, proj: string, doc: string) => `/api/documents/${enc(pub)}/${enc(proj)}/${enc(doc)}`;

export interface Publisher {
  slug: string;
  name: string;
  short_name?: string;
  description: string;
  logo_url?: string;
  website?: string;
  documents?: number;
  projects?: Array<{ slug: string; name: string; description: string; featured: boolean; documents: Array<{ slug: string; name: string; description: string; tags: string[]; repository: string }> }>;
}

export interface DocumentInfo {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  language: string;
  repository: string;
  publisher: { slug: string; name: string };
  project: { slug: string; name: string };
  defaultVersion: string | null;
  declaredDefault: string | null;
  aliases: { stabile: string | null; bozza: string | null };
  versions: Array<{ slug: string; kind: string; ref: string; commit: string; build: number; published_at: string }>;
  /** versioni ritirate dalla dashboard: i loro URL rispondono con la pagina "versione ritirata" (410) */
  withdrawn?: Array<{ slug: string; at: string }>;
}

export interface SitemapData {
  documents: Array<{ publisher: string; project: string; document: string; language: string; version: string; lastmod: string; pages: string[] }>;
}

/** Indirizzo pubblico del sito, per URL canonici e sitemap (SITE_URL; altrimenti quello della richiesta). */
export const siteOrigin = (url: URL) => (process.env.SITE_URL ?? url.origin).replace(/\/$/, '');

export const api = {
  publishers: (): Promise<Publisher[]> => get('/api/publishers', 30_000),
  publisher: (pub: string): Promise<Publisher> => get(`/api/publishers/${enc(pub)}`, 30_000),
  document: (pub: string, proj: string, doc: string): Promise<DocumentInfo> => get(docPath(pub, proj, doc), 15_000),
  /** file di un pacchetto pubblicato; `build` (se noto) rende la cache sicura più a lungo */
  file: (pub: string, proj: string, doc: string, lang: string, ver: string, path: string, build?: number, as: 'json' | 'bytes' = 'json') =>
    get(`${docPath(pub, proj, doc)}/${enc(lang)}/${enc(ver)}/${path.split('/').map(enc).join('/')}${build ? `?b=${build}` : ''}`, build ? 600_000 : 15_000, as),
  sitemap: (): Promise<SitemapData> => get('/api/sitemap', 300_000),
  lookup: (doc: string): Promise<{ publisher: string; project: string; document: string }> => get(`/api/lookup/${enc(doc)}`, 60_000),
  search: (q: string, opts: { publisher?: string; document?: string } = {}) =>
    get(`/api/search?q=${enc(q)}${opts.publisher ? `&publisher=${enc(opts.publisher)}` : ''}${opts.document ? `&document=${enc(opts.document)}` : ''}&limit=30`, 10_000),
};
