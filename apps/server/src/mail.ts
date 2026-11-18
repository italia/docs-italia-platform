/**
 * Invio delle email dell'istanza (per ora solo i magic link della dashboard).
 *
 * - SMTP_URL (smtp:// o smtps://utente:password@host:porta) e SMTP_FROM: invio vero.
 * - Senza SMTP_URL, e solo con il server su indirizzo locale, le email si
 *   scrivono nel log del server: serve alla demo e allo sviluppo. Altrove
 *   l'accesso con magic link resta spento.
 */
import nodemailer from 'nodemailer';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /** "smtp" o "log" (solo sviluppo) */
  kind: 'smtp' | 'log';
  /** descrizione senza segreti, per lo stato dei collegamenti */
  describe: string;
  send(email: Email): Promise<void>;
  /** connessione e autenticazione */
  verify(): Promise<void>;
}

export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  const u = new URL(url);
  return {
    kind: 'smtp',
    describe: `${u.protocol.replace(':', '')}://${u.hostname}${u.port ? `:${u.port}` : ''}${u.username ? ` come ${decodeURIComponent(u.username)}` : ''}, mittente ${from}`,
    async send(email) {
      await transport.sendMail({ from, to: email.to, subject: email.subject, text: email.text });
    },
    async verify() {
      await transport.verify();
    },
  };
}

export function logMailer(log: (line: string) => void = console.log): Mailer {
  return {
    kind: 'log',
    describe: 'nessun SMTP: le email vanno nel log del server (solo su indirizzo locale)',
    async send(email) {
      log(`\n--- email a ${email.to}: ${email.subject}\n${email.text}\n---`);
    },
    async verify() {},
  };
}
