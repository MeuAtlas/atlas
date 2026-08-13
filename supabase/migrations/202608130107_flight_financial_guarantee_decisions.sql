-- Atlas Flight 3C.5: decisões de referência financeira, sem fechamento monetário mensal.
create table if not exists public.flight_financial_guarantee_decisions(
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 month_date date not null,
 planned_import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
 executed_import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
 subject_type text not null check(subject_type='IMPORT'),
 planned_subject_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
 executed_subject_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
 financial_component text not null check(financial_component in ('NORMAL_OPERATING','DEADHEAD','STANDBY_EQUIVALENT','RESERVE','NIGHT','SUNDAY','HOLIDAY','MEAL_ENTITLEMENTS','TRANSPORT_ENTITLEMENTS')),
 quantity_unit text not null,
 planned_quantity bigint not null check(planned_quantity>=0), executed_quantity bigint not null check(executed_quantity>=0),
 decision text not null check(decision in ('PLANNED','EXECUTED','ADDITIVE','NO_DIFFERENCE','UNKNOWN')),
 guarantee_applicable text not null check(guarantee_applicable in ('TRUE','FALSE','UNKNOWN')),
 voluntary_status text not null check(voluntary_status in ('TRUE','FALSE','UNKNOWN')),
 change_origin text not null,
 reason text,
 source_instrument_id uuid references public.flight_legal_instruments(id) on delete restrict,
 source_clause text,
 confidence text not null check(confidence in ('HIGH','MEDIUM','LOW')),
 engine_version text not null,
 provenance jsonb not null default '{}'::jsonb check(jsonb_typeof(provenance)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(planned_import_id,executed_import_id,financial_component)
);
create index if not exists flight_financial_guarantee_decisions_executed_idx on public.flight_financial_guarantee_decisions(executed_import_id,financial_component);
do $$ begin create trigger flight_financial_guarantee_decisions_set_updated_at before update on public.flight_financial_guarantee_decisions for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
alter table public.flight_financial_guarantee_decisions enable row level security;
create policy flight_financial_guarantee_decisions_owner_read on public.flight_financial_guarantee_decisions for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.flight_schedule_imports i where i.id=executed_import_id and i.user_id=auth.uid()));
grant select on public.flight_financial_guarantee_decisions to authenticated;
grant select,insert,update,delete on public.flight_financial_guarantee_decisions to service_role;
