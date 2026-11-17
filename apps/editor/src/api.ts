/** Client delle API dello studio locale. */

export interface Problem {
  level: 'errore' | 'avviso';
  file: string;
  line?: number;
  message: string;
  code: string;
}

export interface PageItem {
  file: string;
  slug: string;
  title: string;
  number?: string;
  depth: number;
}

export interface TocEntry {
  file?: string;
  title?: string;
  children?: TocEntry[];
}

export interface ProjectData {
  root: string;
  settings: { name: string; description: string; tags: string[]; publisher?: string; project?: string; repository?: string };
  toc: { root: string; caption?: string; numbered: boolean; chapters: TocEntry[] };
  pages: PageItem[];
  files: string[];
  drafts: string[];
  problems: Problem[];
}

export interface FileData {
  path: string;
  content: string;
  hash: string;
  draft: { content: string; baseHash: string; updatedAt: string; conflict: boolean } | null;
}

export interface GitData {
  branch?: string;
  branches: string[];
  changes: Array<{ path: string; status: string }>;
  info: { isRepo: boolean; outerRepo?: string; branch?: string; commit?: string; dirty?: boolean };
  log: Array<{ commit: string; date: string; author: string; subject: string }>;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-docs-italia': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

const q = (path: string) => encodeURIComponent(path);

export const api = {
  project: () => call<ProjectData>('GET', '/api/project'),
  file: (path: string) => call<FileData>('GET', `/api/file?path=${q(path)}`),
  saveDraft: (path: string, content: string, baseHash: string) => call('PUT', '/api/draft', { path, content, baseHash }),
  dropDraft: (path: string) => call('DELETE', `/api/draft?path=${q(path)}`),
  save: (path: string, content: string, baseHash: string, force = false) => call<{ hash: string }>('POST', '/api/save', { path, content, baseHash, force }),
  preview: (path: string, content: string) =>
    call<{ html: string; problems: Problem[]; outline: Array<{ anchor: string; title: string; number?: string; depth: number }> }>('POST', '/api/preview', { path, content }),
  check: () => call<Problem[]>('GET', '/api/check'),
  newChapter: (title: string) => call<{ file: string }>('POST', '/api/chapter', { title }),
  saveToc: (chapters: TocEntry[]) => call('PUT', '/api/toc', { chapters }),
  saveSettings: (s: { name: string; description: string; tags: string[] }) => call('PUT', '/api/settings', s),
  git: () => call<GitData>('GET', '/api/git'),
  diff: (path?: string) => call<{ diff: string }>('GET', `/api/git/diff${path ? `?path=${q(path)}` : ''}`),
  branch: (name: string, create: boolean) => call('POST', '/api/git/branch', { name, create }),
  commit: (message: string) => call<{ commit: string; pendingDrafts: number }>('POST', '/api/git/commit', { message }),
  build: () => call<{ timings: Record<string, number>; problems: Problem[]; outputs: Record<string, string> }>('POST', '/api/build'),
};
