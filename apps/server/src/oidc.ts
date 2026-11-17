/**
 * Verifica dei token OIDC delle GitHub Actions che inviano i pacchetti
 * (todo.md, 4.3): nessun segreto da distribuire ai repository.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface ActionClaims {
  /** "owner/repo" */
  repository: string;
  repository_owner: string;
  /** "refs/heads/main" o "refs/tags/1.2.0" */
  ref: string;
  sha: string;
  workflow?: string;
}

export type OidcVerifier = (token: string) => Promise<ActionClaims>;

export function oidcVerifier(opts: { issuer: string; audience: string; jwksUrl?: string; keys?: JWTVerifyGetKey }): OidcVerifier {
  const keys = opts.keys ?? createRemoteJWKSet(new URL(opts.jwksUrl!));
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, { issuer: opts.issuer, audience: opts.audience });
    for (const k of ['repository', 'repository_owner', 'ref', 'sha']) {
      if (typeof payload[k] !== 'string') throw new Error(`token OIDC senza "${k}"`);
    }
    return payload as unknown as ActionClaims;
  };
}
