const HTML: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape per il contenuto testuale (valido sia in HTML sia in XHTML). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML[c]);
}

/** Escape per i valori degli attributi. */
export const escapeAttr = escapeHtml;
