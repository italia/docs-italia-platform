/** Utilità comuni ai server locali (anteprima e studio). */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

export const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.zip': 'application/zip',
  '.ico': 'image/x-icon',
};

/** Percorso dentro `base`, o undefined se esce dalla cartella. */
export function safeJoin(base: string, rel: string): string | undefined {
  const full = resolve(base, normalize(rel).replace(/^([/\\])+/, ''));
  return full === resolve(base) || full.startsWith(resolve(base) + sep) ? full : undefined;
}

export function sendFile(res: ServerResponse, base: string, urlPath: string, fallbackIndex = true): boolean {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (fallbackIndex && (rel === '' || rel.endsWith('/'))) rel += 'index.html';
  let file = safeJoin(base, rel);
  if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file || !existsSync(file)) return false;
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
  return true;
}

export function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

export async function readBody(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('richiesta troppo grande');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

/** Ignora le cartelle generate quando si osservano i file del documento. */
export const isIgnored = (rel: string | null) => !rel || /^(\.docs-italia|dist|node_modules|\.git)([/\\]|$)/.test(rel);
