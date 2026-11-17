/**
 * Validazione dell'EPUB con epubcheck, il validatore ufficiale del W3C.
 * È nell'immagine del toolkit; se non è installato la validazione si salta.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface EpubCheckResult {
  available: boolean;
  ok: boolean;
  messages: string[];
}

export async function epubcheck(file: string): Promise<EpubCheckResult> {
  const cmd = process.env.DOCS_ITALIA_EPUBCHECK ?? 'epubcheck';
  try {
    await run(cmd, ['--quiet', file], { maxBuffer: 10 * 1024 * 1024 });
    return { available: true, ok: true, messages: [] };
  } catch (e: any) {
    if (e.code === 'ENOENT') return { available: false, ok: true, messages: [] };
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    return { available: true, ok: false, messages: out.split('\n').filter((l: string) => /^(ERROR|FATAL|WARNING)/.test(l)) };
  }
}
