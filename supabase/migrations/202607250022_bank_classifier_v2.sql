-- Bank classifier v2: structured direction, independent nature/role and dates.
-- Idempotent: manual confirmations are never overwritten and audit rows are unique.

alter table public.financial_transactions
  add column if not exists bank_direction text,
  add column if not exists financial_nature text,
  add column if not exists financial_role text,
  add column if not exists provider_account_id text,
  add column if not exists provider_type text,
  add column if not exists operation_type text,
  add column if not exists operation_type_additional_info text,
  add column if not exists provider_balance numeric(15,2),
  add column if not exists classification_source text,
  add column if not exists classification_confidence text,
  add column if not exists classification_rule text,
  add column if not exists classification_version text,
  add column if not exists manually_confirmed boolean not null default false,
  add column if not exists manual_override_at timestamptz,
  add column if not exists manual_override_by uuid references auth.users(id) on delete set null,
  add column if not exists provider_posted_at timestamptz,
  add column if not exists bank_posted_at timestamptz,
  add column if not exists effective_at timestamptz,
  add column if not exists user_effective_at timestamptz,
  add column if not exists date_source text,
  add column if not exists date_confidence text,
  add column if not exists date_override_reason text;

alter table public.financial_transactions
  drop constraint if exists financial_transactions_bank_direction_check,
  drop constraint if exists financial_transactions_financial_role_check,
  drop constraint if exists financial_transactions_classification_source_check,
  drop constraint if exists financial_transactions_classification_confidence_check,
  drop constraint if exists financial_transactions_date_source_check,
  drop constraint if exists financial_transactions_date_confidence_check;

alter table public.financial_transactions
  add constraint financial_transactions_bank_direction_check
    check(bank_direction is null or bank_direction in ('inflow','outflow','neutral','review')),
  add constraint financial_transactions_financial_role_check
    check(financial_role is null or financial_role in ('revenue','expense','cash_flow_only','transfer','debt_proceeds','debt_payment','investment_principal','correction','pending_review')),
  add constraint financial_transactions_classification_source_check
    check(classification_source is null or classification_source in ('provider_structured','provider_sign','description_assisted','manual')),
  add constraint financial_transactions_classification_confidence_check
    check(classification_confidence is null or classification_confidence in ('high','medium','low')),
  add constraint financial_transactions_date_source_check
    check(date_source is null or date_source in ('provider_posted','provider_effective','user_confirmed','inferred','legacy')),
  add constraint financial_transactions_date_confidence_check
    check(date_confidence is null or date_confidence in ('high','medium','low'));

create table if not exists public.bank_transaction_classification_audit (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  classifier_version text not null,
  previous_classification jsonb not null default '{}'::jsonb,
  new_classification jsonb not null default '{}'::jsonb,
  applied_rule text not null,
  created_at timestamptz not null default now(),
  unique(transaction_id,classifier_version)
);

alter table public.bank_transaction_classification_audit enable row level security;
drop policy if exists bank_transaction_classification_audit_owner on public.bank_transaction_classification_audit;
create policy bank_transaction_classification_audit_owner
  on public.bank_transaction_classification_audit for select to authenticated
  using(owner_id=auth.uid());
grant select on public.bank_transaction_classification_audit to authenticated;

-- Recover structured fields that older Atlas versions already kept in sanitized metadata.
update public.financial_transactions
set provider_type=coalesce(provider_type,provider_metadata->>'type'),
    operation_type=coalesce(operation_type,provider_metadata->>'operationType'),
    operation_type_additional_info=coalesce(operation_type_additional_info,provider_metadata->>'operationTypeAdditionalInfo'),
    provider_posted_at=coalesce(
      provider_posted_at,
      case when coalesce(provider_metadata->>'date','') ~ '^\d{4}-\d{2}-\d{2}T'
        then (provider_metadata->>'date')::timestamptz end,
      realized_at
    ),
    bank_posted_at=coalesce(
      bank_posted_at,
      case when coalesce(provider_metadata->>'date','') ~ '^\d{4}-\d{2}-\d{2}T'
        then (provider_metadata->>'date')::timestamptz end,
      realized_at
    ),
    date_source=coalesce(
      date_source,
      case when coalesce(provider_metadata->>'date','') ~ '^\d{4}-\d{2}-\d{2}T'
        then 'provider_posted' else 'legacy' end
    ),
    date_confidence=coalesce(date_confidence,'medium')
where source='pluggy' and source_type='bank';

create temporary table atlas_bank_v2_reclassification on commit drop as
with directional as (
  select t.*,
    case
      when upper(coalesce(t.provider_type,t.provider_metadata->>'type',''))='CREDIT' then 'inflow'
      when upper(coalesce(t.provider_type,t.provider_metadata->>'type',''))='DEBIT' then 'outflow'
      when coalesce(t.original_amount,0)>0 then 'inflow'
      when coalesce(t.original_amount,0)<0 then 'outflow'
      else 'review'
    end as new_direction,
    upper(translate(
      coalesce(t.operation_type,t.provider_metadata->>'operationType','')||' '||
      coalesce(t.operation_type_additional_info,t.provider_metadata->>'operationTypeAdditionalInfo','')||' '||
      coalesce(t.provider_category,'')||' '||coalesce(t.description,''),
      'ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ','AAAAEEEIIIOOOOUUUC'
    )) as clue
  from public.financial_transactions t
  where t.source='pluggy' and t.source_type='bank'
    and not t.manually_confirmed
    and t.classification_version is distinct from 'bank_classifier_v2'
), classified as (
  select d.*,
    case
      when exists (
        select 1 from directional peer
        where peer.owner_id=d.owner_id
          and peer.id<>d.id
          and peer.account_id is distinct from d.account_id
          and peer.new_direction<>d.new_direction
          and abs(abs(coalesce(peer.original_amount,peer.amount))-abs(coalesce(d.original_amount,d.amount)))<0.01
          and abs(peer.competence_date-d.competence_date)<=3
          and peer.clue ~ '(PIX|TRANSFER|TED|DOC)'
          and d.clue ~ '(PIX|TRANSFER|TED|DOC)'
      ) then 'transfer_internal'
      when d.new_direction='inflow' and d.clue ~ '(RENDIMENTO APLIC FINANCEIRA|REMUNERACAO (APLIC|CONTA)|RENDIMENTO (APLIC|AUTOMATIC)|JUROS APLIC|RENTABILIDADE)' then 'investment_income'
      when d.new_direction='outflow' and d.clue ~ '(APLICACAO|APORTE|INVESTMENT CONTRIBUTION|TRANSFER.*INVEST)' then 'investment_application'
      when d.new_direction='inflow' and d.clue ~ '(RESGATE APLIC FINANCEIRA|RESGATE.*INVEST|INVESTMENT REDEMPTION)' then 'investment_redemption'
      when d.new_direction='outflow' and d.clue ~ '(PREST CR IM|PRESTACAO CREDITO IMOBILIARIO|FINANCIAMENTO IMOBILIARIO|PARCELA FINANCIAMENTO|CREDITO IMOBILIARIO PREST|PREST HABITACIONAL)' then 'financing_payment'
      when d.new_direction='inflow' and d.clue ~ '(CREDITO DE SALARIO|SALARIO)' then 'salary'
      when d.new_direction='inflow' and d.clue ~ '(OPERACAO CREDITO|EMPRESTIMO|CREDITO CONSIGNADO|FINANCIAMENTO LIBERADO|LIBERACAO.*CREDITO)' then 'loan_proceeds'
      when d.clue ~ 'PIX' and d.new_direction='inflow' then 'pix_received'
      when d.clue ~ 'PIX' and d.new_direction='outflow' then 'pix_sent'
      when d.clue ~ '(PAGAMENTO.*FATURA|FATURA.*PAGAMENTO)' then 'invoice_payment'
      when d.clue ~ '(ESTORNO|REEMBOLSO|REFUND|CHARGEBACK)' then 'refund'
      when d.clue ~ '(TARIFA|FEE|ENCARGO|MULTA)' then 'fee'
      else 'other'
    end as new_nature
  from directional d
), final as (
  select c.*,
    case
      when new_nature='transfer_internal' then 'transfer'
      when new_nature in ('investment_application','investment_redemption') then 'investment_principal'
      when new_nature='loan_proceeds' then 'debt_proceeds'
      when new_nature='financing_payment' then 'debt_payment'
      when new_nature='invoice_payment' then 'cash_flow_only'
      when new_nature='refund' then 'correction'
      when new_direction='inflow' then 'revenue'
      when new_direction='outflow' then 'expense'
      else 'pending_review'
    end as new_role
  from classified c
)
select * from final;

insert into public.bank_transaction_classification_audit(
  owner_id,transaction_id,classifier_version,previous_classification,new_classification,applied_rule
)
select owner_id,id,'bank_classifier_v2',
  jsonb_build_object(
    'direction',bank_direction,'nature',financial_nature,'role',financial_role,
    'transaction_type',transaction_type,'transaction_role',transaction_role,
    'cash_flow_kind',cash_flow_kind,'version',classification_version
  ),
  jsonb_build_object('direction',new_direction,'nature',new_nature,'role',new_role),
  'bank_classifier_v2.backfill'
from atlas_bank_v2_reclassification
on conflict(transaction_id,classifier_version) do nothing;

update public.financial_transactions t
set bank_direction=r.new_direction,
    financial_nature=r.new_nature,
    financial_role=r.new_role,
    transaction_type=case
      when r.new_role='transfer' or r.new_nature='invoice_payment' then 'transfer'
      when r.new_role='correction' then 'refund'
      when r.new_direction='inflow' then 'income'
      when r.new_direction='outflow' then 'expense'
      else 'adjustment'
    end,
    transaction_role=case
      when r.new_role='transfer' then 'transfer'
      when r.new_nature='invoice_payment' then 'invoice_payment'
      when r.new_role='correction' then 'refund'
      when r.new_role='investment_principal' then 'adjustment'
      else 'cash_flow'
    end,
    financial_origin=case
      when r.new_role='transfer' then 'transfer'
      when r.new_nature='invoice_payment' then 'invoice'
      when r.new_role in ('correction','investment_principal') then 'adjustment'
      else 'bank_account'
    end,
    cash_flow_kind=case
      when r.new_nature='investment_application' then 'investment_contribution'
      when r.new_nature='investment_redemption' then 'investment_redemption'
      when r.new_nature='loan_proceeds' then 'loan_proceeds'
      when r.new_nature='invoice_payment' then 'invoice_payment'
      when r.new_nature='transfer_internal' then 'transfer_internal'
      when r.new_nature='refund' then 'refund'
      when r.new_nature in ('financing_payment','debt_payment') then r.new_nature
      when r.new_role='revenue' then 'income'
      when r.new_role='expense' then 'expense'
      else 'cash_flow_only'
    end,
    suspected_transfer=false,
    review_status=case when r.new_role='pending_review' then 'pending' else 'reviewed' end,
    classification_source=case
      when upper(coalesce(r.provider_type,r.provider_metadata->>'type','')) in ('CREDIT','DEBIT')
        then 'provider_structured' else 'provider_sign' end,
    classification_confidence=case
      when upper(coalesce(r.provider_type,r.provider_metadata->>'type','')) in ('CREDIT','DEBIT')
        then 'high' else 'medium' end,
    classification_rule='bank_classifier_v2.backfill.'||r.new_nature,
    classification_version='bank_classifier_v2',
    category_id=coalesce(t.category_id,case
      when r.new_nature='investment_income' then (
        select c.id from public.financial_categories c
        where (c.owner_id=t.owner_id or c.owner_id is null)
          and c.is_active and (lower(c.slug) in ('rendimentos','investment-income') or lower(c.name)='rendimentos')
        order by (c.owner_id=t.owner_id) desc limit 1
      )
      when r.new_nature='financing_payment' then (
        select c.id from public.financial_categories c
        where (c.owner_id=t.owner_id or c.owner_id is null)
          and c.is_active and (lower(c.slug) in ('moradia','financiamento','dividas') or lower(c.name) in ('moradia','financiamento','dívidas'))
        order by (c.owner_id=t.owner_id) desc limit 1
      )
      when r.new_nature='pix_received' then (
        select c.id from public.financial_categories c
        where (c.owner_id=t.owner_id or c.owner_id is null)
          and c.is_active and (lower(c.slug) in ('outras-receitas','other-income') or lower(c.name)='outras receitas')
        order by (c.owner_id=t.owner_id) desc limit 1
      )
    end)
from atlas_bank_v2_reclassification r
where t.id=r.id and not t.manually_confirmed;

create index if not exists financial_transactions_bank_classification
  on public.financial_transactions(owner_id,workspace_id,classification_version,bank_direction,financial_role,competence_date desc);
create index if not exists financial_transactions_attention
  on public.financial_transactions(owner_id,review_status,classification_confidence,competence_date desc)
  where source_type='bank';
