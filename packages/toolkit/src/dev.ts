/**
 * `docs-italia dev`: anteprima locale. Ricostruisce il sito a ogni modifica e
 * ricarica il browser; mostra i problemi in un pannello sopra la pagina.
 */
import { watch } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Problem } from '@docs-italia/schema';
import { build } from './build.ts';
import { formatProblems, ProjectError } from '@docs-italia/myst';
import { isIgnored, json, sendFile } from './serve.ts';

const CLIENT = `<script>
(() => {
  const es = new EventSource('/__docs-italia/events');
  es.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
  fetch('/__docs-italia/problems').then((r) => r.json()).then((ps) => {
    const errs = ps.filter((p) => p.level === 'errore');
    if (!ps.length) return;
    const box = document.createElement('div');
    box.setAttribute('role', 'status');
    box.style.cssText = 'position:fixed;right:1rem;bottom:1rem;max-width:32rem;max-height:40vh;overflow:auto;z-index:9999;background:#fff;border:2px solid ' + (errs.length ? '#cc334d' : '#a66300') + ';padding:.75rem 1rem;font:14px/1.4 system-ui;box-shadow:0 4px 16px #0003';
    box.innerHTML = '<strong>' + errs.length + ' errori, ' + (ps.length - errs.length) + ' avvisi</strong> <button style="float:right" aria-label="Chiudi">×</button><ul style="margin:.5rem 0 0;padding-left:1rem">' +
      ps.map((p) => '<li>' + (p.level === 'errore' ? '✖ ' : '⚠ ') + p.file + (p.line ? ':' + p.line : '') + ' — ' + p.message.replace(/[<&]/g, (c) => c === '<' ? '&lt;' : '&amp;') + '</li>').join('') + '</ul>';
    box.querySelector('button').onclick = () => box.remove();
    document.body.append(box);
  });
})();
</script>`;

export async function dev(root: string, opts: { port: number }) {
  const outDir = join(root, '.docs-italia', 'preview');
  const htmlDir = join(outDir, 'html');
  const clients = new Set<ServerResponse>();
  let problems: Problem[] = [];
  let running: Promise<void> | null = null;
  let again = false;
  let first = true;

  const rebuild = async () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      const t0 = performance.now();
      try {
        const r = await build(root, {
          html: true, pdf: false, epub: false, zip: false, bundle: false,
          outDir, banner: 'Anteprima locale: questa versione non è pubblicata', bodyEnd: CLIENT,
          css: first, minifyCss: false,
        });
        first = false;
        problems = r.problems;
        const e = problems.filter((p) => p.level === 'errore').length;
        console.log(`[${new Date().toLocaleTimeString('it-IT')}] ricostruito in ${Math.round(performance.now() - t0)} ms · ${e} errori, ${problems.length - e} avvisi`);
        if (problems.length) console.log(formatProblems(problems));
      } catch (err) {
        problems = err instanceof ProjectError ? err.problems : [{ level: 'errore', file: '-', code: 'build', message: String((err as Error).message) }];
        console.error(formatProblems(problems));
      }
      for (const c of clients) c.write('data: reload\n\n');
    })().finally(() => {
      running = null;
      if (again) {
        again = false;
        void rebuild();
      }
    });
    return running;
  };

  await rebuild();

  let timer: NodeJS.Timeout | undefined;
  watch(root, { recursive: true }, (_ev, file) => {
    if (isIgnored(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 120);
  });

  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/__docs-italia/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': ok\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url === '/__docs-italia/problems') return json(res, 200, problems);
    if (!sendFile(res, htmlDir, url.slice(1))) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Pagina non trovata');
    }
  });
  // in container DOCS_ITALIA_HOST=0.0.0.0; il compose pubblica la porta solo su 127.0.0.1
  const host = process.env.DOCS_ITALIA_HOST ?? '127.0.0.1';
  server.listen(opts.port, host, () => console.log(`\nAnteprima: http://127.0.0.1:${opts.port}/  (Ctrl+C per uscire)\n`));
}
