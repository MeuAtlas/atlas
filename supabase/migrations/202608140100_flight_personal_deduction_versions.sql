create extension if not exists btree_gist with schema extensions;

alter table public.flight_payroll_personal_deductions
  add column if not exists deduction_group_id uuid;

update public.flight_payroll_personal_deductions
set deduction_group_id = id
where deduction_group_id is null;

alter table public.flight_payroll_personal_deductions
  alter column deduction_group_id set not null;

alter table public.flight_payroll_personal_deductions
  drop constraint if exists flight_payroll_personal_deductions_effective_range_check;

alter table public.flight_payroll_personal_deductions
  add constraint flight_payroll_personal_deductions_effective_range_check
  check (effective_to is null or effective_to >= effective_from);

alter table public.flight_payroll_personal_deductions
  drop constraint if exists flight_payroll_personal_deductions_no_overlap;

alter table public.flight_payroll_personal_deductions
  add constraint flight_payroll_personal_deductions_no_overlap
  exclude using gist (
    user_id with =,
    deduction_group_id with =,
    daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') with &&
  );

create index if not exists flight_payroll_personal_deductions_competence_idx
  on public.flight_payroll_personal_deductions(user_id, effective_from, effective_to);

create or replace function public.create_flight_personal_deduction(
  p_name text,
  p_amount_minor_units bigint,
  p_deductible_from_irrf_base boolean,
  p_effective_from date,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_id uuid;
begin
  if current_user_id is null then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  if nullif(btrim(p_name), '') is null or length(p_name) > 120 or p_amount_minor_units < 0 or p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'Dados do desconto inválidos.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.flight_payroll_personal_deductions item
    where item.user_id = current_user_id
      and lower(btrim(item.name)) = lower(btrim(p_name))
      and item.effective_from <= p_effective_from
      and (item.effective_to is null or item.effective_to >= p_effective_from)
  ) then
    raise exception 'A deduction with this name already exists for this competence.' using errcode = '23P01';
  end if;
  insert into public.flight_payroll_personal_deductions(
    user_id, deduction_group_id, name, category, calculation_type,
    amount_minor_units, deductible_from_irrf_base, effective_from,
    active, source_type, notes
  ) values (
    current_user_id, gen_random_uuid(), btrim(p_name), 'OTHER', 'FIXED',
    p_amount_minor_units, p_deductible_from_irrf_base, p_effective_from,
    true, 'USER_CONFIRMED', nullif(btrim(p_notes), '')
  ) returning id into created_id;
  return created_id;
end $$;

create or replace function public.version_flight_personal_deduction(
  p_current_id uuid,
  p_name text,
  p_amount_minor_units bigint,
  p_deductible_from_irrf_base boolean,
  p_effective_from date,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_version public.flight_payroll_personal_deductions;
  created_id uuid;
begin
  if current_user_id is null then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  select * into current_version
  from public.flight_payroll_personal_deductions
  where id = p_current_id and user_id = current_user_id
  for update;
  if not found then raise exception 'Desconto não encontrado.' using errcode = '42501'; end if;
  if p_effective_from <= current_version.effective_from or p_effective_from <> date_trunc('month', p_effective_from)::date or p_amount_minor_units < 0 or nullif(btrim(p_name), '') is null then
    raise exception 'A nova vigência deve começar após a vigência atual.' using errcode = '22023';
  end if;
  if current_version.effective_to is not null and p_effective_from > current_version.effective_to then
    raise exception 'A versão selecionada já foi encerrada.' using errcode = '22023';
  end if;
  if current_version.effective_to is not null then
    raise exception 'Only the current version can receive a new validity period.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.flight_payroll_personal_deductions item
    where item.user_id = current_user_id
      and item.deduction_group_id <> current_version.deduction_group_id
      and lower(btrim(item.name)) = lower(btrim(p_name))
      and item.effective_from <= p_effective_from
      and (item.effective_to is null or item.effective_to >= p_effective_from)
  ) then
    raise exception 'A deduction with this name already exists for this competence.' using errcode = '23P01';
  end if;
  update public.flight_payroll_personal_deductions
  set effective_to = (p_effective_from - interval '1 day')::date,
      active = false,
      updated_at = now()
  where id = current_version.id;
  insert into public.flight_payroll_personal_deductions(
    user_id, deduction_group_id, name, category, calculation_type,
    amount_minor_units, percentage_basis_points, base_type,
    deductible_from_irrf_base, deductible_from_inss_base,
    effective_from, effective_to, active, source_type, notes
  ) values (
    current_user_id, current_version.deduction_group_id, btrim(p_name),
    current_version.category, 'FIXED', p_amount_minor_units, null, null,
    p_deductible_from_irrf_base, current_version.deductible_from_inss_base,
    p_effective_from, null, true, current_version.source_type, nullif(btrim(p_notes), '')
  ) returning id into created_id;
  return created_id;
end $$;

create or replace function public.end_flight_personal_deduction(
  p_current_id uuid,
  p_stops_from date
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_version public.flight_payroll_personal_deductions;
begin
  if current_user_id is null then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  select * into current_version
  from public.flight_payroll_personal_deductions
  where id = p_current_id and user_id = current_user_id
  for update;
  if not found then raise exception 'Desconto não encontrado.' using errcode = '42501'; end if;
  if p_stops_from <= current_version.effective_from or p_stops_from <> date_trunc('month', p_stops_from)::date then
    raise exception 'A competência de encerramento deve ser posterior ao início da vigência.' using errcode = '22023';
  end if;
  if current_version.effective_to is not null then
    raise exception 'The selected deduction has already ended.' using errcode = '22023';
  end if;
  update public.flight_payroll_personal_deductions
  set effective_to = (p_stops_from - interval '1 day')::date,
      active = false,
      updated_at = now()
  where id = current_version.id;
  return current_version.id;
end $$;

revoke all on function public.create_flight_personal_deduction(text,bigint,boolean,date,text) from public, anon;
revoke all on function public.version_flight_personal_deduction(uuid,text,bigint,boolean,date,text) from public, anon;
revoke all on function public.end_flight_personal_deduction(uuid,date) from public, anon;
grant execute on function public.create_flight_personal_deduction(text,bigint,boolean,date,text) to authenticated;
grant execute on function public.version_flight_personal_deduction(uuid,text,bigint,boolean,date,text) to authenticated;
grant execute on function public.end_flight_personal_deduction(uuid,date) to authenticated;
