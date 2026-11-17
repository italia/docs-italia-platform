-- Modello dati di un'istanza Docs Italia (todo.md, 6.3).
-- Stessa gerarchia della piattaforma attuale: publisher → progetto → documento
-- → versione → build. Lo schema è nuovo: si ripopola da GitHub e dall'inventario.

create extension if not exists pg_trgm;

create table publisher (
  id serial primary key,
  slug text not null unique,             -- organizzazione GitHub
  name text not null,
  short_name text,
  description text not null default '',
  website text,
  logo_url text,
  conf_repo text not null default 'italia-conf',
  metadata jsonb not null default '{}',  -- publisher_settings.yml validato
  active boolean not null default true,
  synced_at timestamptz,
  sync_error text
);

create table project (
  id serial primary key,
  publisher_id int not null references publisher(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  metadata jsonb not null default '{}',  -- voce di projects_settings.yml
  active boolean not null default true,
  featured boolean not null default false,
  sort int not null default 0,
  unique (publisher_id, slug)
);

create table document (
  id serial primary key,
  project_id int references project(id) on delete set null,
  slug text not null,                    -- nome del repository, in minuscolo
  repo_owner text not null,
  repo_name text not null,
  name text not null default '',
  description text not null default '',
  tags text[] not null default '{}',
  language text not null default 'it',
  format text not null default 'rst',    -- rst | myst
  settings jsonb not null default '{}',  -- document_settings.yml validato
  default_version text,                  -- slug della versione predefinita, o null = regola del repository
  draft_branch text,
  active boolean not null default true,
  sync_error text,
  unique (repo_owner, repo_name)
);
create index document_project on document(project_id);

create table version (
  id serial primary key,
  document_id int not null references document(id) on delete cascade,
  slug text not null,                    -- bozza, 1.2.0, versione-corrente…
  kind text not null,                    -- draft | release | branch | archived
  ref text,                              -- branch o tag
  commit text,
  active boolean not null default true,
  published_build_id int,                -- build pubblicata: pubblicare è spostare questo puntatore
  created_at timestamptz not null default now(),
  unique (document_id, slug)
);

create table build (
  id serial primary key,
  document_id int not null references document(id) on delete cascade,
  version_id int references version(id) on delete set null,
  ref text,
  commit text,
  origin text not null default 'worker', -- worker | action
  status text not null default 'queued', -- queued | running | ok | failed
  bundle_prefix text,                    -- percorso nello storage
  manifest jsonb,
  problems jsonb not null default '[]',
  error text,
  log text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index build_document on build(document_id, created_at desc);
alter table version add constraint version_build foreign key (published_build_id) references build(id) on delete set null;

-- coda dei lavori: FOR UPDATE SKIP LOCKED, senza Redis
create table job (
  id bigserial primary key,
  kind text not null,                    -- sync | build
  payload jsonb not null default '{}',
  status text not null default 'queued', -- queued | running | done | failed
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index job_ready on job(status, run_after) where status = 'queued';

-- ricerca del sito: una riga per sezione della build pubblicata
create table search_section (
  id bigserial primary key,
  build_id int not null references build(id) on delete cascade,
  document_id int not null references document(id) on delete cascade,
  version_id int not null references version(id) on delete cascade,
  page text not null,
  anchor text not null,
  title text not null,
  path text[] not null default '{}',
  body text not null,
  tsv tsvector generated always as (
    setweight(to_tsvector('italian', coalesce(title, '')), 'A') || setweight(to_tsvector('italian', coalesce(body, '')), 'B')
  ) stored
);
create index search_section_tsv on search_section using gin(tsv);
create index search_section_title_trgm on search_section using gin(title gin_trgm_ops);

-- interventi della dashboard che prevalgono sul repository (todo.md, 6.6)
create table version_override (
  id serial primary key,
  version_id int not null references version(id) on delete cascade,
  action text not null,                  -- withdraw | promote | archive
  reason text not null,
  actor text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text,
  detail jsonb not null default '{}'
);

create table webhook_delivery (
  id bigserial primary key,
  at timestamptz not null default now(),
  delivery_id text,
  event text not null,
  owner text,
  repo text,
  outcome text not null,
  detail jsonb not null default '{}'
);
