/**
 * EPUB 3 generato dall'AST: un file XHTML per pagina, indice di navigazione,
 * immagini, CSS semplice. Il file "mimetype" va per primo e non compresso.
 */
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { epubCss, escapeAttr, escapeHtml, renderEpubChapter, type DocView } from '@docs-italia/render';

const MEDIA: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export function buildEpub(doc: DocView, opts: { sourceDir: string; assets: string[]; identifier: string; modified: Date }): Uint8Array {
  const id = (s: string) => 'x-' + s.replace(/[^a-zA-Z0-9]/g, '-');
  const chapterFile = (slug: string) => `${slug.replace(/\//g, '__')}.xhtml`;
  const images = opts.assets.filter((a) => MEDIA[extname(a).toLowerCase()]);
  const modified = opts.modified.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${escapeAttr(doc.language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${escapeHtml(opts.identifier)}</dc:identifier>
<dc:title>${escapeHtml(doc.name)}</dc:title>
<dc:language>${escapeHtml(doc.language)}</dc:language>
<dc:description>${escapeHtml(doc.description)}</dc:description>
${doc.publisher ? `<dc:publisher>${escapeHtml(doc.publisher)}</dc:publisher>` : ''}
${doc.tags.map((t) => `<dc:subject>${escapeHtml(t)}</dc:subject>`).join('\n')}
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="epub.css" media-type="text/css"/>
${doc.pages.map((p) => `<item id="${id(p.slug)}" href="${escapeAttr(chapterFile(p.slug))}" media-type="application/xhtml+xml"/>`).join('\n')}
${images.map((a) => `<item id="${id(a)}" href="${escapeAttr(a)}" media-type="${MEDIA[extname(a).toLowerCase()]}"/>`).join('\n')}
</manifest>
<spine>
${doc.pages.map((p) => `<itemref idref="${id(p.slug)}"/>`).join('\n')}
</spine>
</package>
`;

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeAttr(doc.language)}" xml:lang="${escapeAttr(doc.language)}">
<head><meta charset="utf-8" /><title>${escapeHtml(doc.caption ?? 'Indice')}</title><link rel="stylesheet" type="text/css" href="epub.css" /></head>
<body>
<nav epub:type="toc" id="toc"><h1>${escapeHtml(doc.caption ?? 'Indice dei contenuti')}</h1>
<ol>
${doc.pages
  .map((p) => `<li><a href="${escapeAttr(chapterFile(p.slug))}">${p.number ? `${escapeHtml(p.number)}. ` : ''}${escapeHtml(p.title)}</a></li>`)
  .join('\n')}
</ol>
</nav>
</body>
</html>
`;

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/epub.css': readFileSync(epubCss),
  };
  for (const p of doc.pages) {
    // in EPUB i link tra capitoli usano il nome del file XHTML
    files[`OEBPS/${chapterFile(p.slug)}`] = strToU8(renderEpubChapter(doc, p).replace(/href="([^"#]+)\.xhtml/g, (_m, s) => `href="${chapterFile(s)}`));
  }
  for (const a of images) files[`OEBPS/${a}`] = [readFileSync(join(opts.sourceDir, a)), { level: 0 }];
  return zipSync(files, { level: 9 });
}
