import { expect, test } from 'bun:test';
import { configFromEnv } from '../src/config.ts';

test('magic link: email normalizzate; senza SMTP le email vanno nel log solo su indirizzo locale', () => {
  const local = configFromEnv({ DASHBOARD_ADMIN_EMAILS: ' Nome.Cognome@AgID.gov.it, ,altra@example.gov.it', FORGE_LOCAL_ROOT: '/tmp' });
  expect(local.adminEmails).toEqual(['nome.cognome@agid.gov.it', 'altra@example.gov.it']);
  expect(local.mailer?.kind).toBe('log');
  expect(local.magicLinkTtlMinutes).toBe(15);
  expect(local.sessionTtlHours).toBe(8);
  expect(configFromEnv({ HOST: '0.0.0.0', FORGE_LOCAL_ROOT: '/tmp' }).mailer).toBeUndefined();
  const smtp = configFromEnv({ HOST: '0.0.0.0', SMTP_URL: 'smtps://utente:segreto@smtp.example.gov.it:465', FORGE_LOCAL_ROOT: '/tmp' });
  expect(smtp.mailer?.kind).toBe('smtp');
  expect(smtp.mailer?.describe).not.toContain('segreto');
  expect(configFromEnv({ MAGIC_LINK_TTL_MINUTES: 'abc', FORGE_LOCAL_ROOT: '/tmp' }).magicLinkTtlMinutes).toBe(15);
});
