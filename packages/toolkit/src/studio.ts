/**
 * `docs-italia studio`: server locale dell'editor.
 *
 * - Il contenuto vive solo nei file del repository. SQLite tiene le bozze non
 *   ancora salvate e un registro delle operazioni: cancellarlo non fa perdere
 *   nulla di già salvato.
 * - Git solo in locale: branch, commit, diff. Nessun push.
 * - Ascolta solo su 127.0.0.1; le richieste che modificano qualcosa devono
 *   avere l'intestazione X-Docs-Italia (un altro sito aperto nel browser non
 *   può inviarla senza un preflight CORS, che qui non è consentito).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, relative } from 'node:path';
import { Database } from 'bun:sqlite';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { renderPreview } from '@docs-italia/render';
import { DocumentSettingsSchema, parseToc, type Problem } from '@docs-italia/schema';
import { build } from './build.ts';
import { gitCheckout, gitCommit, gitDiff, gitInfo, gitLog, gitStatus } from '@docs-italia/forge';
import { loadProject, ProjectError, resolveProject, slugify } from '@docs-italia/myst';
import { isIgnored, json, readBody, safeJoin, sendFile } from './serve.ts';

const EDITOR_DIST = fileURLToPath(new URL('../../../apps/editor/dist/', import.meta.url));
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function studio(root: string, opts: { port: number }) {
  mkdirSync(join(root, '.docs-italia'), { recursive: true });
  const db = new Database(join(root, '.docs-italia', 'studio.sqlite'));
  db.exec(`
    create table if not exists drafts (path text primary key, content text not null, base_hash text, updated_at text not null);
    create table if not exists events (id integer primary key, at text not null, kind text not null, detail text);
  `);
  const logEvent = (kind: string, detail: unknown) =>
    db.prepare('insert into events (at, kind, detail) values (?, ?, ?)').run(new Date().toISOString(), kind, JSON.stringify(detail));
  const getDraft = (path: string) => db.prepare('select content, base_hash, updated_at from drafts where path = ?').get(path) as { content: string; base_hash: string; updated_at: string } | null;

  const project = () => loadProject(root);
  const srcPath = (p: ReturnType<typeof project>, rel: string, mustBeMd = true) => {
    if (mustBeMd && !rel.endsWith('.md')) throw new HttpError(400, 'si possono modificare solo file .md');
    const full = safeJoin(p.sourceDir, rel);
    if (!full) throw new HttpError(400, 'percorso non valido');
    return full;
  };
  const readerWith = (p: ReturnType<typeof project>, override?: { path: string; content: string }) => (file: string) => {
    if (override && file === override.path) return override.content;
    const d = getDraft(file);
    return d ? d.content : readFileSync(join(p.sourceDir, file), 'utf8');
  };
  const safeProblems = (fn: () => Problem[]): Problem[] => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ProjectError) return e.problems;
      throw e;
    }
  };

  // notifiche all'editor quando un file cambia sul disco (es. modificato in un altro programma)
  const clients = new Set<ServerResponse>();
  watch(root, { recursive: true }, (_ev, file) => {
    if (isIgnored(file)) return;
    for (const c of clients) c.write(`data: ${JSON.stringify({ type: 'file', file })}\n\n`);
  });

  const routes: Record<string, (req: IncomingMessage, url: URL) => Promise<unknown> | unknown> = {
    'GET /api/project': () => {
      const p = project();
      const doc = resolveProject(p, readerWith(p));
      const drafts = (db.prepare('select path, updated_at from drafts').all() as Array<{ path: string; updated_at: string }>).map((d) => d.path);
      return {
        root,
        settings: p.settings,
        toc: p.toc,
        pages: doc.pages.map(({ file, slug, title, number, depth, hidden }) => ({ file, slug, title, number, depth, hidden })),
        files: p.markdownFiles,
        drafts,
        problems: doc.problems,
        inventory: doc.inventory,
      };
    },
    'GET /api/file': (_req, url) => {
      const p = project();
      const rel = url.searchParams.get('path') ?? '';
      const disk = readFileSync(srcPath(p, rel), 'utf8');
      const d = getDraft(rel);
      return { path: rel, content: disk, hash: sha(disk), draft: d ? { content: d.content, baseHash: d.base_hash, updatedAt: d.updated_at, conflict: d.base_hash !== sha(disk) } : null };
    },
    'PUT /api/draft': async (req) => {
      const { path, content, baseHash } = await readBody(req);
      srcPath(project(), path);
      db.prepare('insert into drafts (path, content, base_hash, updated_at) values (?, ?, ?, ?) on conflict(path) do update set content = excluded.content, updated_at = excluded.updated_at').run(path, content, baseHash ?? null, new Date().toISOString());
      return { ok: true };
    },
    'DELETE /api/draft': (_req, url) => {
      db.prepare('delete from drafts where path = ?').run(url.searchParams.get('path') ?? '');
      return { ok: true };
    },
    'POST /api/save': async (req) => {
      const { path, content, baseHash, force } = await readBody(req);
      const p = project();
      const full = srcPath(p, path);
      const disk = existsSync(full) ? readFileSync(full, 'utf8') : '';
      if (baseHash && baseHash !== sha(disk) && !force) throw new HttpError(409, 'il file è cambiato sul disco dopo che hai iniziato a modificarlo');
      writeFileSync(full, content);
      db.prepare('delete from drafts where path = ?').run(path);
      logEvent('save', { path, bytes: content.length });
      return { ok: true, hash: sha(content) };
    },
    'POST /api/preview': async (req) => {
      const { path, content } = await readBody(req);
      const p = project();
      const doc = resolveProject(p, readerWith(p, { path, content }));
      const page = doc.pages.find((x) => x.file === path);
      return {
        html: page ? renderPreview(page, '/files/') : '<p>Questo file non è nell’indice del documento: non verrà pubblicato.</p>',
        problems: doc.problems.filter((x) => x.file === path),
        outline: page?.sections ?? [],
      };
    },
    'GET /api/check': () => safeProblems(() => {
      const p = project();
      return resolveProject(p, readerWith(p)).problems;
    }),
    'POST /api/chapter': async (req) => {
      const { title } = await readBody(req);
      if (!title?.trim()) throw new HttpError(400, 'serve un titolo');
      const p = project();
      const file = `${slugify(title)}.md`;
      const full = srcPath(p, file);
      if (existsSync(full)) throw new HttpError(409, `esiste già ${file}`);
      writeFileSync(full, `# ${title.trim()}\n\nTesto del capitolo.\n`);
      const tocFile = join(p.sourceDir, 'toc.json');
      const toc = JSON.parse(readFileSync(tocFile, 'utf8'));
      toc.chapters.push({ file });
      writeFileSync(tocFile, JSON.stringify(toc, null, 2) + '\n');
      logEvent('chapter', { file });
      return { file };
    },
    'PUT /api/toc': async (req) => {
      const { chapters } = await readBody(req);
      const p = project();
      const tocFile = join(p.sourceDir, 'toc.json');
      const toc = JSON.parse(readFileSync(tocFile, 'utf8'));
      toc.chapters = chapters;
      const check = parseToc(JSON.stringify(toc));
      if (!check.ok) throw new HttpError(400, check.problems.map((x) => x.message).join('; '));
      writeFileSync(tocFile, JSON.stringify(toc, null, 2) + '\n');
      logEvent('toc', { chapters: chapters.length });
      return { ok: true };
    },
    'PUT /api/settings': async (req) => {
      const { name, description, tags } = await readBody(req);
      const file = join(root, 'document_settings.yml');
      // parseDocument conserva commenti e ordine dei campi
      const ydoc = parseDocument(readFileSync(file, 'utf8'));
      if (name !== undefined) ydoc.setIn(['document', 'name'], name);
      if (description !== undefined) ydoc.setIn(['document', 'description'], description);
      if (tags !== undefined) ydoc.setIn(['document', 'tags'], ydoc.createNode(tags));
      const r = DocumentSettingsSchema.safeParse(ydoc.toJS());
      if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join('; '));
      writeFileSync(file, ydoc.toString());
      logEvent('settings', { name });
      return { ok: true };
    },
    'GET /api/git': async () => ({ ...(await gitStatus(root)), info: await gitInfo(root), log: await gitLog(root, 8) }),
    'GET /api/git/diff': async (_req, url) => ({ diff: await gitDiff(root, url.searchParams.get('path') ?? undefined) }),
    'POST /api/git/branch': async (req) => {
      const { name, create } = await readBody(req);
      await gitCheckout(root, String(name), Boolean(create));
      logEvent('branch', { name, create });
      return { ok: true };
    },
    'POST /api/git/commit': async (req) => {
      const { message } = await readBody(req);
      const pending = (db.prepare('select count(*) as n from drafts').get() as { n: number }).n;
      const commit = await gitCommit(root, String(message ?? ''));
      logEvent('commit', { commit, message });
      return { commit, pendingDrafts: pending };
    },
    'POST /api/build': async () => {
      const r = await build(root, {});
      logEvent('build', { timings: r.timings, problems: r.problems.length });
      return { timings: r.timings, problems: r.problems, outputs: Object.fromEntries(Object.entries(r.outputs).map(([k, v]) => [k, relative(root, v)])) };
    },
    'GET /api/events/log': () => db.prepare('select at, kind, detail from events order by id desc limit 30').all(),
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    try {
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': ok\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      const route = routes[`${method} ${url.pathname}`];
      if (route) {
        if (method !== 'GET' && req.headers['x-docs-italia'] !== '1') throw new HttpError(403, 'intestazione X-Docs-Italia mancante');
        return json(res, 200, await route(req, url));
      }
      if (url.pathname.startsWith('/files/')) {
        if (sendFile(res, project().sourceDir, url.pathname.slice('/files/'.length), false)) return;
      } else if (url.pathname.startsWith('/sito/')) {
        if (sendFile(res, join(root, 'dist', 'html'), url.pathname.slice('/sito/'.length))) return;
      } else if (method === 'GET') {
        if (sendFile(res, EDITOR_DIST, url.pathname.slice(1)) || sendFile(res, EDITOR_DIST, 'index.html')) return;
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end("Interfaccia dell'editor non compilata: esegui `npm run editor:build` nella cartella poc.");
      }
      throw new HttpError(404, 'non trovato');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof ProjectError ? 422 : 500;
      json(res, status, { error: (e as Error).message, problems: e instanceof ProjectError ? e.problems : undefined });
    }
  });
  // in container DOCS_ITALIA_HOST=0.0.0.0; il compose pubblica la porta solo su 127.0.0.1
  const host = process.env.DOCS_ITALIA_HOST ?? '127.0.0.1';
  server.listen(opts.port, host, () => console.log(`\nStudio: http://127.0.0.1:${opts.port}/  (Ctrl+C per uscire)\n`));
}
