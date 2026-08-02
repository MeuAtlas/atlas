begin;

alter table public.monthly_financial_reports
  add column if not exists total_real_income numeric(15,2) not null default 0,
  add column if not exists total_bank_inflows numeric(15,2) not null default 0,
  add column if not exists personal_card_consumption numeric(15,2) not null default 0,
  add column if not exists future_commitments_30d numeric(15,2) not null default 0,
  add column if not exists future_commitments_60d numeric(15,2) not null default 0,
  add column if not exists future_commitments_90d numeric(15,2) not null default 0,
  add column if not exists income_reference_amount numeric(15,2),
  add column if not exists income_absolute_difference numeric(15,2),
  add column if not exists income_percentage_difference numeric(9,2),
  add column if not exists income_history_month_count integer not null default 0,
  add column if not exists card_reference_amount numeric(15,2),
  add column if not exists card_absolute_difference numeric(15,2),
  add column if not exists card_percentage_difference numeric(9,2),
  add column if not exists card_history_month_count integer not null default 0;

create or replace function public.hydrate_monthly_report_analytics()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  new.snapshot_schema_version := coalesce((new.snapshot_json->>'schemaVersion')::integer, new.snapshot_schema_version, 1);
  new.total_real_income := coalesce((new.snapshot_json#>>'{totals,totalRealIncome}')::numeric, 0);
  new.total_bank_inflows := coalesce((new.snapshot_json#>>'{totals,totalBankInflows}')::numeric, (new.snapshot_json#>>'{totals,totalIncome}')::numeric, 0);
  new.personal_card_consumption := coalesce((new.snapshot_json#>>'{totals,personalCardConsumption}')::numeric, 0);
  new.future_commitments_30d := coalesce((new.snapshot_json#>>'{totals,futureCommitments30d}')::numeric, 0);
  new.future_commitments_60d := coalesce((new.snapshot_json#>>'{totals,futureCommitments60d}')::numeric, 0);
  new.future_commitments_90d := coalesce((new.snapshot_json#>>'{totals,futureCommitments90d}')::numeric, 0);
  new.income_reference_amount := (new.snapshot_json#>>'{incomePerspective,reference}')::numeric;
  new.income_absolute_difference := (new.snapshot_json#>>'{incomePerspective,absoluteDifference}')::numeric;
  new.income_percentage_difference := (new.snapshot_json#>>'{incomePerspective,percentageDifference}')::numeric;
  new.income_history_month_count := coalesce((new.snapshot_json#>>'{incomePerspective,monthsUsed}')::integer, 0);
  new.card_reference_amount := (new.snapshot_json#>>'{cardPerspective,reference}')::numeric;
  new.card_absolute_difference := (new.snapshot_json#>>'{cardPerspective,absoluteDifference}')::numeric;
  new.card_percentage_difference := (new.snapshot_json#>>'{cardPerspective,percentageDifference}')::numeric;
  new.card_history_month_count := coalesce((new.snapshot_json#>>'{cardPerspective,monthsUsed}')::integer, 0);
  return new;
end $$;

drop trigger if exists monthly_report_analytics_from_snapshot on public.monthly_financial_reports;
create trigger monthly_report_analytics_from_snapshot
before insert or update of snapshot_json on public.monthly_financial_reports
for each row execute function public.hydrate_monthly_report_analytics();

update public.monthly_financial_reports
set snapshot_json=snapshot_json
where snapshot_json is not null;

commit;
