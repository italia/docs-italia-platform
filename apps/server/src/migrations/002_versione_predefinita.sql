-- Versione predefinita di un documento: una sola regola per API, sito e ricerca.
-- Prima l'API e la ricerca la calcolavano in modi diversi, e nessuna delle due
-- riconosceva una predefinita dichiarata con il nome del branch ("master" → "bozza").

-- ordinamento numerico degli slug: 1.10 dopo 1.9, v2026-04-20 dopo v2025-12-01
create collation if not exists numerico (provider = icu, locale = 'und-u-kn-true');

-- Tra le versioni attive e pubblicate, nell'ordine:
-- 1. quella dichiarata (document.default_version) per slug;
-- 2. quella dichiarata per branch o tag (ref);
-- 3. l'ultima release, per numero di versione;
-- 4. le altre (bozza, branch), la più recente.
create function default_version_id(doc int) returns int
language sql stable as $$
  select v.id
  from version v join document d on d.id = v.document_id
  where v.document_id = doc and v.active and v.published_build_id is not null
  order by
    (v.slug = d.default_version) desc nulls last,
    (v.ref = d.default_version) desc nulls last,
    (v.kind = 'release') desc,
    case when v.kind = 'release' then v.slug end collate numerico desc nulls last,
    v.created_at desc
  limit 1
$$;
