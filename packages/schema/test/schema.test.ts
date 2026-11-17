import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { filterTags, parseDocumentSettings, parseToc } from '../src/index.ts';

test('un document_settings.yml attuale (solo name, description, tags) resta valido', () => {
  const r = parseDocumentSettings('document:\n  name: Linee guida\n  description: Descrizione\n  tags: [a, b]\n');
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.document.format, 'rst', 'senza "format" vale RST');
    assert.equal(r.value.document.source, '.');
  }
});

test('i campi ignorati dal fork (author, type…) sono conservati', () => {
  const r = parseDocumentSettings('document:\n  name: x\n  description: y\n  tags: [a]\n  author: AgID\n  type: linee guida\n');
  assert.ok(r.ok);
  if (r.ok) assert.equal((r.value.document as Record<string, unknown>).author, 'AgID');
});

test('campi obbligatori mancanti: messaggi in italiano', () => {
  const r = parseDocumentSettings('document:\n  name: x\n');
  assert.equal(r.ok, false);
  const msgs = r.problems.map((p) => p.message).join(' | ');
  assert.match(msgs, /description.*obbligatorio/);
  assert.match(msgs, /tags.*obbligatorio/);
});

test('YAML non valido', () => {
  const r = parseDocumentSettings('document: [\n');
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].code, 'yaml');
});

test('toc.json: voci che non puntano a .md e voci senza file né figli', () => {
  assert.equal(parseToc('{"chapters":[{"file":"a.md"},{"title":"Gruppo","children":[{"file":"b.md"}]}]}').ok, true);
  assert.equal(parseToc('{"chapters":[{"file":"a.rst"}]}').ok, false);
  assert.equal(parseToc('{"chapters":[{"title":"solo titolo"}]}').ok, false);
  assert.equal(parseToc('{"chapters":[], "extra": 1}').ok, false, 'campi sconosciuti rifiutati');
});

test('filtro dei tag sul vocabolario, come il fork', () => {
  assert.deepEqual(filterTags([' UX ', 'PDND', 'inventato'], ['ux', 'pdnd']), { kept: ['ux', 'pdnd'], dropped: ['inventato'] });
});
