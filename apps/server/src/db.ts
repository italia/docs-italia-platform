/**
 * Accesso a PostgreSQL con il driver integrato in Bun (Bun.sql).
 *
 * Attenzione ai jsonb: si passano oggetti JavaScript, mai JSON.stringify(…):
 * una stringa verrebbe salvata come stringa JSON, cioè codificata due volte.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { SQL } from 'bun';

export type Db = SQL;

export function connect(url: string, max = 10): Db {
  return new SQL(url, { max });
}

/** Applica in ordine i file di migrations/ non ancora applicati, ognuno in una transazione. */
export async function migrate(sql: Db): Promise<string[]> {
  await sql`create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migration`).map((r: { name: string }) => r.name));
  const dir = new URL('./migrations/', import.meta.url);
  const applied: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const text = readFileSync(new URL(name, dir), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migration (name) values (${name})`;
    });
    applied.push(name);
  }
  return applied;
}
