/**
 * Chiamate all'API di amministrazione del server (/api/admin).
 *
 * Con il server in DASHBOARD_OPEN=1 non serve nulla; altrimenti si usa il
 * token di amministrazione, tenuto solo nella sessione del browser, finché non
 * c'è l'accesso con magic link (todo.md, 6.6).
 */
import { useCallback, useEffect, useState } from 'react';

const TOKEN_KEY = 'docs-italia-admin-token';

export const token = {
  get(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(value: string) {
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
    } catch {}
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {}
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token.get();
  if (t) headers.authorization = `Bearer ${t}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/admin${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `errore ${res.status}`, res.status);
  return data as T;
}

/** Dati di una rotta GET, con ricarica. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api<T>(path)
      .then((data) => alive && setState({ data, loading: false }))
      .catch((error) => alive && setState({ error, loading: false }));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  return { ...state, reload };
}

// ---------------------------------------------------------------- tipi delle risposte

export type CheckStatus = 'ok' | 'avviso' | 'errore' | 'non configurato';
export interface Check {
  group: string;
  name: string;
  status: CheckStatus;
  detail: string;
}
export interface ChecksResult {
  at: string;
  checks: Check[];
}

export interface Whoami {
  actor: string;
  open: boolean;
  siteUrl: string;
  forge: string;
}

export interface Override {
  id: number;
  action: 'withdraw' | 'promote' | 'archive';
  reason: string;
  actor: string;
  created_at: string;
}

export interface Overview {
  counts: Record<'publishers' | 'projects' | 'documents' | 'versions' | 'queued' | 'running' | 'failed_jobs' | 'failed_builds_week', number>;
  attention: {
    failing: Array<{ build: number; error: string | null; created_at: string; document_id: number; repo_owner: string; repo_name: string; name: string; version: string; published: boolean }>;
    publishers: Array<{ slug: string; name: string; sync_error: string; synced_at: string | null }>;
    documents: Array<{ id: number; repo_owner: string; repo_name: string; name: string; sync_error: string; active: boolean }>;
    withErrors: Array<{ id: number; repo_owner: string; repo_name: string; name: string; version: string; errors: number }>;
  };
  overrides: Array<Override & { version_id: number; version: string; document_id: number; repo_owner: string; repo_name: string }>;
}

export interface Publisher {
  slug: string;
  name: string;
  conf_repo: string;
  active: boolean;
  synced_at: string | null;
  sync_error: string | null;
  projects: number;
  documents: number;
  document_errors: number;
  last_webhook: string | null;
}

export interface DocumentRow {
  id: number;
  slug: string;
  name: string;
  repo_owner: string;
  repo_name: string;
  format: string;
  language: string;
  active: boolean;
  sync_error: string | null;
  project: string | null;
  project_name: string | null;
  default_version: string | null;
  versions: number;
  last_build: number | null;
  last_status: string | null;
  last_at: string | null;
  errors: number;
  overridden: boolean;
}

export interface VersionRow {
  id: number;
  slug: string;
  kind: string;
  ref: string | null;
  commit: string | null;
  active: boolean;
  created_at: string;
  published_build_id: number | null;
  published_at: string | null;
  errors: number;
  problems: number;
  last_build: number | null;
  last_status: string | null;
  last_at: string | null;
  overrides: Override[];
}

export interface BuildRow {
  id: number;
  document_id?: number;
  repository?: string;
  version: string | null;
  origin: string;
  status: string;
  commit: string | null;
  error: string | null;
  problems: number;
  created_at: string;
  finished_at: string | null;
}

export interface DocumentDetail {
  id: number;
  slug: string;
  name: string;
  description: string;
  repo_owner: string;
  repo_name: string;
  format: string;
  language: string;
  active: boolean;
  sync_error: string | null;
  draft_branch: string | null;
  default_version: string | null;
  default_version_id: number | null;
  project: string | null;
  project_name: string | null;
  publisher_name: string | null;
  settings: Record<string, unknown>;
  versions: VersionRow[];
  builds: BuildRow[];
}

export interface Problem {
  level: 'errore' | 'avviso';
  code: string;
  file?: string;
  line?: number;
  message: string;
}

export interface BuildDetail extends Omit<BuildRow, 'problems'> {
  document_id: number;
  repo_owner: string;
  repo_name: string;
  document_name: string;
  format: string;
  ref: string | null;
  log: string;
  problems: Problem[];
  started_at: string | null;
  published: boolean | null;
}

export interface Job {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: string;
  created_at: string;
  finished_at: string | null;
}

export interface WebhookDelivery {
  id: number;
  at: string;
  delivery_id: string | null;
  event: string;
  owner: string | null;
  repo: string | null;
  outcome: string;
  detail: Record<string, unknown>;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
}
