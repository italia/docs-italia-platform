-- Interventi della dashboard sulla versione predefinita (todo.md, 6.6).
-- Una versione promossa dalla dashboard prevale su document_settings.yml
-- finché la promozione non viene revocata ("torna alla regola del repository").

create or replace function default_version_id(doc int) returns int
language sql stable as $$
  select v.id
  from version v join document d on d.id = v.document_id
  where v.document_id = doc and v.active and v.published_build_id is not null
  order by
    exists (select 1 from version_override o where o.version_id = v.id and o.action = 'promote' and o.revoked_at is null) desc,
    (v.slug = d.default_version) desc nulls last,
    (v.ref = d.default_version) desc nulls last,
    (v.kind = 'release') desc,
    case when v.kind = 'release' then v.slug end collate numerico desc nulls last,
    v.created_at desc
  limit 1
$$;

create index if not exists version_override_active on version_override(version_id, action) where revoked_at is null;
