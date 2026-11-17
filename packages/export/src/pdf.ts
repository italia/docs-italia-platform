/**
 * PDF dalla pagina di stampa con Chrome headless.
 *
 * Due motori:
 * - "pagedjs" (predefinito): Paged.js impagina nel browser prima della stampa:
 *   numeri di pagina nell'indice, margini con contenuto, copertina senza numero.
 * - "chrome": CSS di stampa e piè di pagina di Chrome. Niente numeri di pagina
 *   nell'indice, numero anche sulla copertina; utile se Paged.js non regge un documento.
 *
 * La pagina è servita da un server HTTP locale: Paged.js legge i fogli di stile
 * con fetch, che Chrome non permette su file://.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { escapeHtml } from '@docs-italia/render';

export type PdfEngine = 'chrome' | 'pagedjs';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** Server statico sulla cartella del sito, su una porta libera, solo in locale. */
async function serve(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const base = resolve(root);
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
    const file = resolve(base, normalize(rel));
    if ((file !== base && !file.startsWith(base + sep)) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((ok) => server.close(() => ok())) };
}

export interface PdfOptions {
  engine?: PdfEngine;
}

export async function htmlToPdf(htmlFile: string, pdfFile: string, title: string, opts: PdfOptions = {}): Promise<void> {
  const engine = opts.engine ?? 'pagedjs';
  const executablePath = process.env.DOCS_ITALIA_CHROME;
  const site = await serve(dirname(htmlFile));
  // in container Chromium gira come root: serve --no-sandbox (il container fa da isolamento)
  const args = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
  const browser = await chromium.launch(executablePath ? { executablePath, args } : { channel: 'chrome', args });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (engine === 'pagedjs') {
      await page.addInitScript('window.PagedConfig = { auto: false };');
      // Paged.js impagina con gli stili attivi in quel momento: se fossero quelli
      // dello schermo, le regole @media print (dimensioni delle immagini…)
      // cambierebbero le altezze solo in stampa, a pagine già divise, e il
      // contenuto in eccesso verrebbe tagliato. Si impagina già in modalità stampa.
      await page.emulateMedia({ media: 'print' });
    }
    await page.goto(site.url + basename(htmlFile), { waitUntil: 'load' });
    await page.evaluate('document.fonts.ready'); // eseguito nel browser
    if (engine === 'pagedjs') {
      const polyfill = join(dirname(createRequire(import.meta.url).resolve('pagedjs/package.json')), 'dist', 'paged.polyfill.js');
      await page.addScriptTag({ path: polyfill });
      await page.evaluate('window.PagedPolyfill.preview()');
      if (errors.length) throw new Error(`Paged.js: ${errors.join('; ')}`);
      await page.pdf({ path: pdfFile, printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
    } else {
      await page.pdf({
        path: pdfFile,
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="font-size:8px;width:100%;padding:0 18mm;display:flex;justify-content:space-between;font-family:sans-serif;color:#555"><span>${escapeHtml(
          title,
        )}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
        tagged: true,
        outline: true,
      });
    }
  } finally {
    await browser.close();
    await site.close();
  }
}
