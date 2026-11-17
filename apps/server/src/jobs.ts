/**
 * Coda dei lavori in PostgreSQL (FOR UPDATE SKIP LOCKED): più worker possono
 * prendere lavori in parallelo senza Redis.
 */
import type { Db } from './db.ts';

export type JobKind = 'sync' | 'build';

export interface Job {
  id: number;
  kind: JobKind;
  payload: Record<string, any>;
  attempts: number;
  max_attempts: number;
}

export async function enqueue(sql: Db, kind: JobKind, payload: Record<string, unknown>): Promise<number> {
  const [row] = await sql`insert into job (kind, payload) values (${kind}, ${payload}) returning id`;
  return Number(row.id);
}

/** Prende il prossimo lavoro pronto, o null. */
export async function claim(sql: Db): Promise<Job | null> {
  const [row] = await sql`
    update job set status = 'running', locked_at = now(), attempts = attempts + 1
    where id = (
      select id from job where status = 'queued' and run_after <= now()
      order by id for update skip locked limit 1
    )
    returning id, kind, payload, attempts, max_attempts`;
  return row ? { ...row, id: Number(row.id) } : null;
}

export async function complete(sql: Db, id: number) {
  await sql`update job set status = 'done', finished_at = now(), last_error = null where id = ${id}`;
}

/** Fallimento: si riprova con attesa crescente, fino a max_attempts. */
export async function fail(sql: Db, job: Job, error: string) {
  const retry = job.attempts < job.max_attempts;
  await sql`
    update job set
      status = ${retry ? 'queued' : 'failed'},
      last_error = ${error.slice(0, 4000)},
      run_after = now() + (${30 * 2 ** job.attempts} || ' seconds')::interval,
      finished_at = ${retry ? null : new Date()}
    where id = ${job.id}`;
}
