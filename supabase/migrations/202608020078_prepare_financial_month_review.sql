begin;

create or replace function public.prepare_financial_month_for_review(p_month_id uuid)
returns public.financial_months
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.financial_months;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_month_id::text,0));
  select * into target from public.financial_months where id=p_month_id for update;

  if target.id is null then
    raise exception 'Mês financeiro não encontrado.' using errcode='P0002';
  end if;
  if not public.can_admin_workspace(target.workspace_id) then
    raise exception 'Você não pode preparar este mês para revisão.' using errcode='42501';
  end if;
  if target.period_end>now() then
    raise exception 'Este mês ainda está em andamento.' using errcode='22023';
  end if;

  if target.status='review' then return target; end if;
  if target.status='open' then
    update public.financial_months set status='awaiting_consolidation' where id=target.id returning * into target;
  end if;
  if target.status in ('awaiting_consolidation','reopened') then
    update public.financial_months set status='review' where id=target.id returning * into target;
  else
    raise exception 'Este mês não pode ser preparado para revisão no estado atual.' using errcode='22023';
  end if;

  insert into public.monthly_report_audit_logs(
    workspace_id,financial_month_id,report_id,action,performed_by,metadata
  ) values(
    target.workspace_id,target.id,target.current_report_id,
    'consolidation_started',auth.uid(),jsonb_build_object('status',target.status)
  );
  return target;
end $$;

revoke all on function public.prepare_financial_month_for_review(uuid) from public,anon;
grant execute on function public.prepare_financial_month_for_review(uuid) to authenticated;

commit;
