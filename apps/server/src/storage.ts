/**
 * Archiviazione dei pacchetti e dei file scaricabili: file system in locale,
 * object storage S3-compatibile (MinIO, …) in produzione.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { S3Client } from 'bun';

export interface Storage {
  put(key: string, data: Uint8Array | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<string[]>;
  remove(prefix: string): Promise<void>;
}

/**
 * Percorso relativo sicuro: niente "/" iniziale, "\\", caratteri nulli né
 * segmenti "." o ".." (che risalgono di cartella) o vuoti. Due punti dentro un
 * nome sono ammessi: "modello-a-valorizzazione-culturale..json" è un file vero.
 */
export function isSafePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function safeKey(key: string): string {
  if (!isSafePath(key)) throw new Error(`chiave non valida: ${key}`);
  return key;
}

export class FsStorage implements Storage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    const p = resolve(this.root, safeKey(key));
    if (!p.startsWith(this.root + sep)) throw new Error(`chiave non valida: ${key}`);
    return p;
  }
  async put(key: string, data: Uint8Array | string) {
    const p = this.path(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  }
  async get(key: string) {
    const p = this.path(key);
    return existsSync(p) && statSync(p).isFile() ? new Uint8Array(readFileSync(p)) : null;
  }
  async list(prefix: string) {
    const base = this.path(prefix);
    const out: string[] = [];
    const walk = (d: string) => {
      if (!existsSync(d)) return;
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else out.push(relative(this.root, f).split(sep).join('/'));
      }
    };
    walk(base);
    return out;
  }
  async remove(prefix: string) {
    rmSync(this.path(prefix), { recursive: true, force: true });
  }
}

export class S3Storage implements Storage {
  private client: S3Client;
  constructor(opts: { bucket: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string; region?: string }) {
    this.client = new S3Client(opts);
  }
  async put(key: string, data: Uint8Array | string, contentType?: string) {
    await this.client.write(safeKey(key), data, contentType ? { type: contentType } : undefined);
  }
  async get(key: string) {
    const f = this.client.file(safeKey(key));
    return (await f.exists()) ? new Uint8Array(await f.arrayBuffer()) : null;
  }
  async list(prefix: string) {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.list({ prefix: safeKey(prefix), continuationToken: token });
      for (const o of r.contents ?? []) out.push(o.key);
      token = r.isTruncated ? r.nextContinuationToken : undefined;
    } while (token);
    return out;
  }
  async remove(prefix: string) {
    for (const k of await this.list(prefix)) await this.client.delete(k);
  }
}
