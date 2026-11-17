/**
 * Lettura MyST con le estensioni di Docs Italia.
 *
 * Le estensioni sono direttive e ruoli MyST normali: lo stesso meccanismo
 * servirà per forum_italia, plantuml, i ruoli HTTP e `only`.
 */
import { mystParse } from 'myst-parser';
import { VFile } from 'vfile';
import type { DirectiveSpec, RoleSpec, GenericNode, GenericParent } from 'myst-common';
import type { Problem } from '@docs-italia/schema';

/** `highlights` (docutils): testo in evidenza in apertura. Non esiste in MyST. */
const highlights: DirectiveSpec = {
  name: 'highlights',
  doc: 'Testo in evidenza, come la direttiva highlights di docutils.',
  body: { type: 'myst', required: true },
  run(data) {
    return [{ type: 'container', kind: 'quote', class: 'highlights', children: [{ type: 'blockquote', children: (data.body as GenericNode[]) ?? [] }] }];
  },
};

/** {rfc}`7519` o {rfc}`7519#section-4`: 1.255 occorrenze nel corpus RST. */
const rfc: RoleSpec = {
  name: 'rfc',
  alias: ['RFC'],
  doc: 'Collegamento a una RFC IETF.',
  body: { type: String, required: true },
  run(data) {
    const [num, section] = String(data.body).trim().split('#');
    return [
      {
        type: 'link',
        url: `https://www.rfc-editor.org/rfc/rfc${num}${section ? `#${section}` : ''}`,
        children: [{ type: 'text', value: `RFC ${num}` }],
      },
    ];
  },
};

/**
 * {forum_italia}: discussione su forum.italia.it (270 occorrenze nel corpus RST).
 * Se mantenerla è la decisione 2 del piano: intanto le opzioni si conservano.
 */
const forum: DirectiveSpec = {
  name: 'forum_italia',
  alias: ['forum', 'discourse'],
  doc: 'Collegamento alla discussione del documento su Forum Italia.',
  options: { topic_id: { type: Number }, scope: { type: String } },
  run(data) {
    return [{ type: 'forum', topicId: data.options?.topic_id, scope: data.options?.scope }];
  },
};

export const docsItaliaDirectives: DirectiveSpec[] = [highlights, forum];
export const docsItaliaRoles: RoleSpec[] = [rfc];

export interface ParseResult {
  tree: GenericParent;
  problems: Problem[];
}

export function parseMyst(content: string, file: string): ParseResult {
  const vfile = new VFile({ path: file, value: content });
  // mystParse aggiunge da solo direttive e ruoli predefiniti: qui solo le estensioni
  // smartquotes disattivato: l'AST conserva il testo come è scritto, così l'editor
  // può riscrivere un blocco senza cambiare apostrofi e virgolette
  const tree = mystParse(content, { vfile, directives: docsItaliaDirectives, roles: docsItaliaRoles, extensions: { smartquotes: false } });
  const problems: Problem[] = vfile.messages.map((m) => ({
    level: m.fatal ? 'errore' : 'avviso',
    file,
    line: m.line ?? undefined,
    code: 'myst',
    message: m.reason,
  }));
  return { tree, problems };
}
