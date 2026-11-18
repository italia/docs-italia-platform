-- Accesso alla dashboard con magic link (todo.md, 6.6).
-- Dei link e delle sessioni si salva solo l'hash (sha256) del token.

-- Ogni richiesta di link, anche per email non autorizzate: serve al limite di
-- frequenza per email e per indirizzo IP. Solo le richieste autorizzate hanno un token.
create table admin_login_request (
  id bigserial primary key,
  email text not null,          -- normalizzata: minuscole, senza spazi
  ip text,
  token_hash text unique,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index admin_login_request_email on admin_login_request(email, created_at);
create index admin_login_request_ip on admin_login_request(ip, created_at);

create table admin_session (
  id bigserial primary key,
  email text not null,
  token_hash text not null unique,
  ip text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz
);
