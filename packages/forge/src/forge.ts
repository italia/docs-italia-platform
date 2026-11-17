/**
 * Interfaccia comune verso il fornitore Git (todo.md, 6.5).
 *
 * Il resto della piattaforma non sa se parla con GitHub, con GitLab o con
 * cartelle locali: legge file, elenca branch e tag, estrae la sorgente a un ref.
 */

export interface RepoInfo {
  owner: string;
  name: string;
  defaultBranch: string;
  archived: boolean;
  url: string;
}

export interface Ref {
  name: string;
  commit: string;
}

export interface Refs {
  branches: Ref[];
  tags: Ref[];
}

/** Esito di un controllo di collegamento (dashboard, todo.md 6.6). */
export type CheckStatus = 'ok' | 'avviso' | 'errore' | 'non configurato';
export interface Check {
  group: string;
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface Forge {
  readonly kind: 'local' | 'github';
  /**
   * Stato del collegamento: modalità di accesso, credenziali, limiti, accesso
   * alle organizzazioni indicate. Non contiene mai segreti.
   */
  status(owners: string[]): Promise<Check[]>;
  /** Informazioni sul repository, o null se non esiste. */
  repo(owner: string, name: string): Promise<RepoInfo | null>;
  /** Contenuto di un file a un ref (predefinito: branch predefinito), o null se non esiste. */
  readFile(owner: string, name: string, path: string, ref?: string): Promise<string | null>;
  refs(owner: string, name: string): Promise<Refs>;
  /** Estrae la sorgente al ref indicato in `dest` (cartella vuota). Restituisce il commit. */
  checkout(owner: string, name: string, ref: string, dest: string): Promise<{ commit: string }>;
}

/** "https://github.com/italia/repo(.git)" → { owner, name }. */
export function parseRepoUrl(url: string): { owner: string; name: string } | null {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1]!, name: m[2]! } : null;
}
