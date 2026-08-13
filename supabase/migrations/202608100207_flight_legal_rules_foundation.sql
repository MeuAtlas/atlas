-- Atlas Flight Etapa 3A: base versionada para instrumentos e regras jurídicas.
-- Não insere instrumentos, cláusulas ou regras reais.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('flight-legal-documents','flight-legal-documents',false,52428800,array['application/pdf'])
on conflict (id) do update set
  public=false,
  file_size_limit=52428800,
  allowed_mime_types=array['application/pdf'];

create table if not exists public.flight_legal_instruments(
  id uuid primary key default gen_random_uuid(),
  instrument_type text not null check(instrument_type in ('LAW','REGULATION','CCT','ACT','ADDENDUM','OTHER','INTERNAL_CONFIRMED_RULE')),
  instrument_code text not null check(instrument_code ~ '^[A-Z0-9][A-Z0-9._-]{1,119}$'),
  title text not null,
  short_title text,
  company_code text,
  union_code text,
  category text,
  effective_from date not null,
  effective_to date,
  signed_at date,
  published_at date,
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED','ACTIVE','SUPERSEDED','RETIRED')),
  source_filename text,
  storage_bucket text check(storage_bucket is null or storage_bucket='flight-legal-documents'),
  storage_path text,
  file_hash_sha256 text check(file_hash_sha256 is null or file_hash_sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text check(mime_type is null or mime_type='application/pdf'),
  file_size bigint check(file_size is null or (file_size > 0 and file_size <= 52428800)),
  source_url text,
  source_notes text,
  version integer not null default 1 check(version >= 1),
  supersedes_instrument_id uuid references public.flight_legal_instruments(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  check(effective_to is null or effective_to >= effective_from),
  check(supersedes_instrument_id is null or supersedes_instrument_id <> id),
  check((storage_path is null and storage_bucket is null) or (storage_path is not null and storage_bucket='flight-legal-documents')),
  unique(instrument_code,version),
  unique(storage_bucket,storage_path),
  unique(file_hash_sha256)
);

create table if not exists public.flight_legal_clauses(
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.flight_legal_instruments(id) on delete restrict,
  clause_number text,
  clause_key text,
  title text,
  source_text text not null,
  normalized_text text,
  interpretation_notes text,
  effective_from date,
  effective_to date,
  page_start integer check(page_start is null or page_start > 0),
  page_end integer check(page_end is null or page_end > 0),
  parent_clause_id uuid references public.flight_legal_clauses(id) on delete restrict,
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED','ACTIVE','SUPERSEDED','RETIRED')),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(effective_to is null or effective_from is null or effective_to >= effective_from),
  check(page_end is null or page_start is null or page_end >= page_start),
  unique(instrument_id,clause_key)
);

create table if not exists public.flight_rules(
  id uuid primary key default gen_random_uuid(),
  rule_key text not null check(rule_key ~ '^[A-Z0-9][A-Z0-9._-]{1,119}$'),
  rule_version integer not null check(rule_version >= 1),
  title text not null,
  description text,
  rule_category text not null check(rule_category in ('OPERATING_LIMIT','REST','STANDBY','RESERVE','OFF_DAY','NIGHT_OPERATION','TRAINING','DEADHEAD','MEAL_ALLOWANCE','FLIGHT_PAY','SENIORITY','INDEMNITY','ADDITIONAL_PAY','OTHER')),
  effective_from date not null,
  effective_to date,
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED','ACTIVE','SUPERSEDED','RETIRED')),
  priority integer not null default 0,
  scope jsonb not null default '{}'::jsonb check(jsonb_typeof(scope)='object'),
  conditions jsonb not null default '{}'::jsonb check(jsonb_typeof(conditions)='object'),
  calculation jsonb not null default '{}'::jsonb check(jsonb_typeof(calculation)='object'),
  source_confidence text not null default 'UNVERIFIED' check(source_confidence in ('UNVERIFIED','LOW','MEDIUM','HIGH')),
  review_status text not null default 'DRAFT' check(review_status in ('DRAFT','REVIEWED','APPROVED','REJECTED')),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  check(effective_to is null or effective_to >= effective_from),
  unique(rule_key,rule_version)
);

create table if not exists public.flight_rule_sources(
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.flight_rules(id) on delete restrict,
  instrument_id uuid not null references public.flight_legal_instruments(id) on delete restrict,
  clause_id uuid references public.flight_legal_clauses(id) on delete restrict,
  source_role text not null check(source_role in ('PRIMARY','SUPPLEMENTARY','OVERRIDES','LIMITS','REFERENCES')),
  notes text,
  created_at timestamptz not null default now(),
  unique(rule_id,instrument_id,clause_id,source_role)
);

create table if not exists public.flight_rule_sets(
  id uuid primary key default gen_random_uuid(),
  ruleset_code text not null check(ruleset_code ~ '^[A-Z0-9][A-Z0-9._-]{1,119}$'),
  name text not null,
  description text,
  effective_from date not null,
  effective_to date,
  status text not null default 'DRAFT' check(status in ('DRAFT','REVIEWED','ACTIVE','SUPERSEDED','RETIRED')),
  version integer not null default 1 check(version >= 1),
  company_code text,
  employee_category text,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  check(effective_to is null or effective_to >= effective_from),
  unique(ruleset_code,version)
);

create table if not exists public.flight_rule_set_rules(
  ruleset_id uuid not null references public.flight_rule_sets(id) on delete restrict,
  rule_id uuid not null references public.flight_rules(id) on delete restrict,
  sequence integer not null check(sequence > 0),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  primary key(ruleset_id,rule_id),
  unique(ruleset_id,sequence)
);

create table if not exists public.flight_rule_precedence(
  id uuid primary key default gen_random_uuid(),
  higher_rule_id uuid not null references public.flight_rules(id) on delete restrict,
  lower_rule_id uuid not null references public.flight_rules(id) on delete restrict,
  precedence_type text not null check(precedence_type in ('OVERRIDES','SUPPLEMENTS','LIMITS','MORE_SPECIFIC_THAN')),
  reason text not null,
  source_clause_id uuid references public.flight_legal_clauses(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(higher_rule_id <> lower_rule_id),
  unique(higher_rule_id,lower_rule_id,precedence_type)
);

create table if not exists public.flight_rule_audit_logs(
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check(event_type in ('LEGAL_INSTRUMENT_CREATED','LEGAL_INSTRUMENT_REVIEWED','LEGAL_INSTRUMENT_ACTIVATED','LEGAL_INSTRUMENT_SUPERSEDED','CLAUSE_CREATED','CLAUSE_UPDATED','RULE_CREATED','RULE_REVIEWED','RULE_ACTIVATED','RULE_SUPERSEDED','RULESET_CREATED','RULESET_ACTIVATED','RULE_MANIFEST_VALIDATED','RULE_MANIFEST_APPLIED')),
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now()
);

create index if not exists flight_legal_instruments_status_effective_idx on public.flight_legal_instruments(status,effective_from,effective_to);
create index if not exists flight_legal_instruments_expiry_idx on public.flight_legal_instruments(effective_to) where effective_to is not null;
create index if not exists flight_legal_clauses_instrument_idx on public.flight_legal_clauses(instrument_id);
create index if not exists flight_rules_lookup_idx on public.flight_rules(rule_key,status,effective_from,effective_to);
create index if not exists flight_rules_scope_idx on public.flight_rules using gin(scope);
create index if not exists flight_rule_sources_rule_idx on public.flight_rule_sources(rule_id);
create index if not exists flight_rule_audit_logs_entity_idx on public.flight_rule_audit_logs(entity_type,entity_id,created_at desc);

create or replace function public.validate_flight_rule_source_clause()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.clause_id is not null and not exists(
    select 1 from public.flight_legal_clauses c where c.id=new.clause_id and c.instrument_id=new.instrument_id
  ) then
    raise exception 'A cláusula informada não pertence ao instrumento da fonte.' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function public.prevent_flight_active_rule_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='ACTIVE' and new.status='ACTIVE' and (
    new.rule_key,new.rule_version,new.title,new.description,new.rule_category,new.effective_from,new.effective_to,new.priority,new.scope,new.conditions,new.calculation,new.source_confidence,new.review_status,new.metadata
  ) is distinct from (
    old.rule_key,old.rule_version,old.title,old.description,old.rule_category,old.effective_from,old.effective_to,old.priority,old.scope,old.conditions,old.calculation,old.source_confidence,old.review_status,old.metadata
  ) then
    raise exception 'Regra ACTIVE não pode ser editada; crie uma nova versão.' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function public.prevent_flight_active_rule_overlap()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='ACTIVE' and exists(
    select 1 from public.flight_rules r
    where r.id <> new.id
      and r.status='ACTIVE'
      and r.rule_key=new.rule_key
      and r.scope=new.scope
      and daterange(r.effective_from,coalesce(r.effective_to,'infinity'::date),'[]') && daterange(new.effective_from,coalesce(new.effective_to,'infinity'::date),'[]')
  ) then
    raise exception 'Já existe uma regra ACTIVE com a mesma chave, escopo e vigência sobreposta.' using errcode='23505';
  end if;
  return new;
end $$;

do $$ begin create trigger flight_rule_sources_validate_clause before insert or update on public.flight_rule_sources for each row execute function public.validate_flight_rule_source_clause(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_rules_prevent_active_mutation before update on public.flight_rules for each row execute function public.prevent_flight_active_rule_mutation(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_rules_prevent_active_overlap before insert or update on public.flight_rules for each row execute function public.prevent_flight_active_rule_overlap(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_legal_instruments_set_updated_at before update on public.flight_legal_instruments for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_legal_clauses_set_updated_at before update on public.flight_legal_clauses for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_rules_set_updated_at before update on public.flight_rules for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_rule_sets_set_updated_at before update on public.flight_rule_sets for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;

alter table public.flight_legal_instruments enable row level security;
alter table public.flight_legal_clauses enable row level security;
alter table public.flight_rules enable row level security;
alter table public.flight_rule_sources enable row level security;
alter table public.flight_rule_sets enable row level security;
alter table public.flight_rule_set_rules enable row level security;
alter table public.flight_rule_precedence enable row level security;
alter table public.flight_rule_audit_logs enable row level security;

create policy flight_legal_instruments_authenticated_read on public.flight_legal_instruments for select to authenticated using(true);
create policy flight_legal_clauses_authenticated_read on public.flight_legal_clauses for select to authenticated using(true);
create policy flight_rules_authenticated_read on public.flight_rules for select to authenticated using(true);
create policy flight_rule_sources_authenticated_read on public.flight_rule_sources for select to authenticated using(true);
create policy flight_rule_sets_authenticated_read on public.flight_rule_sets for select to authenticated using(true);
create policy flight_rule_set_rules_authenticated_read on public.flight_rule_set_rules for select to authenticated using(true);
create policy flight_rule_precedence_authenticated_read on public.flight_rule_precedence for select to authenticated using(true);
create policy flight_rule_audit_logs_authenticated_read on public.flight_rule_audit_logs for select to authenticated using(true);

grant select on public.flight_legal_instruments,public.flight_legal_clauses,public.flight_rules,public.flight_rule_sources,public.flight_rule_sets,public.flight_rule_set_rules,public.flight_rule_precedence,public.flight_rule_audit_logs to authenticated;
