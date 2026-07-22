create table public.financial_categories (
 id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users(id) on delete cascade, name text not null, slug text not null,
 type text not null check(type in ('income','expense','both')), parent_id uuid references public.financial_categories(id) on delete set null,
 icon text, color text, is_system boolean not null default false, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,slug)
);
create unique index financial_categories_system_slug on public.financial_categories(slug) where owner_id is null;
create table public.financial_accounts (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, workspace_id uuid references public.workspaces(id) on delete set null,
 name text not null, institution_name text, account_type text not null check(account_type in ('checking','savings','digital','cash','investment','international','other')),
 currency char(3) not null default 'BRL', opening_balance numeric(15,2) not null default 0, current_balance numeric(15,2) not null default 0, balance_updated_at timestamptz not null default now(),
 visibility text not null default 'private' check(visibility in ('private','workspace')), status text not null default 'active' check(status in ('active','archived')),
 color text, icon text, source text not null default 'manual' check(source in ('manual','pluggy','ofx','csv')), external_id text, last_sync_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((visibility='private' and workspace_id is null) or (visibility='workspace' and workspace_id is not null))
);
create table public.recurring_rules (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, workspace_id uuid references public.workspaces(id) on delete set null,
 transaction_type text not null check(transaction_type in ('income','expense')), description text not null, category_id uuid references public.financial_categories(id), account_id uuid references public.financial_accounts(id),
 amount numeric(15,2) not null check(amount>0), frequency text not null check(frequency in ('weekly','monthly','quarterly','yearly')), starts_on date not null, ends_on date, next_generation date not null,
 status text not null default 'active' check(status in ('active','paused','finished')), settings jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.installment_plans (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, description text not null, total_amount numeric(15,2) not null check(total_amount>0),
 installment_count integer not null check(installment_count>0), starts_on date not null, account_id uuid references public.financial_accounts(id), card_id uuid, category_id uuid references public.financial_categories(id),
 status text not null default 'active' check(status in ('active','finished','cancelled')), source text not null default 'manual', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.financial_transactions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, workspace_id uuid references public.workspaces(id) on delete set null,
 account_id uuid not null references public.financial_accounts(id), destination_account_id uuid references public.financial_accounts(id), category_id uuid references public.financial_categories(id),
 transaction_type text not null check(transaction_type in ('income','expense','transfer','reversal','refund','adjustment')), status text not null default 'pending' check(status in ('forecast','pending','partial','realized','overdue','cancelled')),
 description text not null, amount numeric(15,2) not null check(amount>0), competence_date date not null, due_date date, realized_at timestamptz,
 visibility text not null default 'private' check(visibility in ('private','workspace')), source text not null default 'manual' check(source in ('manual','pluggy','ofx','csv','recurrence','card','automation')),
 external_id text, notes text, recurring_rule_id uuid references public.recurring_rules(id) on delete set null, installment_plan_id uuid references public.installment_plans(id) on delete set null,
 transfer_group_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((visibility='private' and workspace_id is null) or (visibility='workspace' and workspace_id is not null)), check(transaction_type<>'transfer' or destination_account_id is not null)
);
create table public.credit_cards (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, workspace_id uuid references public.workspaces(id) on delete set null,
 linked_account_id uuid references public.financial_accounts(id) on delete set null, name text not null, institution_name text, last_four_digits char(4), brand text,
 credit_limit numeric(15,2) not null default 0 check(credit_limit>=0), closing_day integer not null check(closing_day between 1 and 31), due_day integer not null check(due_day between 1 and 31),
 visibility text not null default 'private' check(visibility in ('private','workspace')), source text not null default 'manual', external_id text, status text not null default 'active' check(status in ('active','archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check((visibility='private' and workspace_id is null) or (visibility='workspace' and workspace_id is not null))
);
alter table public.installment_plans add constraint installment_plans_card_fk foreign key(card_id) references public.credit_cards(id);
create table public.card_invoices (
 id uuid primary key default gen_random_uuid(), card_id uuid not null references public.credit_cards(id) on delete cascade, owner_id uuid not null references auth.users(id) on delete cascade,
 reference_month date not null, closing_date date not null, due_date date not null, total_amount numeric(15,2) not null default 0, paid_amount numeric(15,2) not null default 0,
 status text not null default 'open' check(status in ('open','closed','partial','paid','overdue','cancelled')), external_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(card_id,reference_month)
);
create table public.card_purchases (
 id uuid primary key default gen_random_uuid(), card_id uuid not null references public.credit_cards(id) on delete cascade, invoice_id uuid references public.card_invoices(id) on delete set null,
 owner_id uuid not null references auth.users(id) on delete cascade, workspace_id uuid references public.workspaces(id) on delete set null, category_id uuid references public.financial_categories(id),
 description text not null, total_amount numeric(15,2) not null check(total_amount>0), purchase_date date not null, installment_number integer not null default 1 check(installment_number>0),
 installment_count integer not null default 1 check(installment_count>0), installment_amount numeric(15,2) not null check(installment_amount>0), visibility text not null default 'private' check(visibility in ('private','workspace')),
 source text not null default 'manual', external_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check((visibility='private' and workspace_id is null) or (visibility='workspace' and workspace_id is not null))
);
create table public.bank_connections (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, provider text not null, provider_connection_id text not null,
 status text not null default 'pending' check(status in ('pending','active','error','disabled')), last_sync_at timestamptz, metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,provider,provider_connection_id)
);

create unique index financial_transactions_import_unique on public.financial_transactions(owner_id,source,external_id) where external_id is not null;
create index financial_transactions_owner_date on public.financial_transactions(owner_id,competence_date desc);
create index financial_transactions_workspace on public.financial_transactions(workspace_id) where workspace_id is not null;
create index financial_accounts_owner on public.financial_accounts(owner_id,status);

do $$ declare t text; begin
 foreach t in array array['financial_categories','financial_accounts','financial_transactions','credit_cards','card_invoices','card_purchases','recurring_rules','installment_plans','bank_connections'] loop
  execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
  execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;

create or replace function public.can_read_finance(owner uuid, ws uuid, vis text)
returns boolean language sql stable security definer set search_path=''
as $$ select owner=auth.uid() or (vis='workspace' and ws is not null and public.is_workspace_member(ws)) $$;
create or replace function public.can_write_finance(owner uuid, ws uuid, vis text)
returns boolean language sql stable security definer set search_path=''
as $$ select owner=auth.uid() or (vis='workspace' and ws is not null and public.can_edit_workspace(ws)) $$;
grant execute on function public.can_read_finance(uuid,uuid,text), public.can_write_finance(uuid,uuid,text) to authenticated;

create policy categories_read on public.financial_categories for select to authenticated using (owner_id is null or owner_id=auth.uid());
create policy categories_write on public.financial_categories for all to authenticated using (owner_id=auth.uid()) with check(owner_id=auth.uid() and not is_system);
create policy accounts_read on public.financial_accounts for select to authenticated using(public.can_read_finance(owner_id,workspace_id,visibility));
create policy accounts_write on public.financial_accounts for all to authenticated using(public.can_write_finance(owner_id,workspace_id,visibility)) with check(public.can_write_finance(owner_id,workspace_id,visibility));
create policy transactions_read on public.financial_transactions for select to authenticated using(public.can_read_finance(owner_id,workspace_id,visibility));
create policy transactions_write on public.financial_transactions for all to authenticated using(public.can_write_finance(owner_id,workspace_id,visibility)) with check(public.can_write_finance(owner_id,workspace_id,visibility));
create policy cards_read on public.credit_cards for select to authenticated using(public.can_read_finance(owner_id,workspace_id,visibility));
create policy cards_write on public.credit_cards for all to authenticated using(public.can_write_finance(owner_id,workspace_id,visibility)) with check(public.can_write_finance(owner_id,workspace_id,visibility));
create policy purchases_read on public.card_purchases for select to authenticated using(public.can_read_finance(owner_id,workspace_id,visibility));
create policy purchases_write on public.card_purchases for all to authenticated using(public.can_write_finance(owner_id,workspace_id,visibility)) with check(public.can_write_finance(owner_id,workspace_id,visibility));
create policy invoices_read on public.card_invoices for select to authenticated using(owner_id=auth.uid());
create policy invoices_write on public.card_invoices for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy recurring_owner on public.recurring_rules for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy installments_owner on public.installment_plans for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy connections_owner on public.bank_connections for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());

create or replace function public.validate_financial_transaction_accounts()
returns trigger language plpgsql security invoker set search_path=''
as $$ declare account_owner uuid; account_workspace uuid; account_visibility text; begin
 select owner_id,workspace_id,visibility into account_owner,account_workspace,account_visibility from public.financial_accounts where id=new.account_id;
 if account_owner is null or not public.can_write_finance(account_owner,account_workspace,account_visibility) then raise exception 'account access denied'; end if;
 if new.owner_id<>auth.uid() then raise exception 'invalid transaction owner'; end if;
 if new.destination_account_id is not null then
  select owner_id,workspace_id,visibility into account_owner,account_workspace,account_visibility from public.financial_accounts where id=new.destination_account_id;
  if account_owner is null or not public.can_write_finance(account_owner,account_workspace,account_visibility) then raise exception 'destination account access denied'; end if;
 end if;
 return new;
end $$;
create trigger financial_transactions_validate before insert or update on public.financial_transactions for each row execute function public.validate_financial_transaction_accounts();

insert into public.financial_categories(owner_id,name,slug,type,is_system,is_active) values
 (null,'Salário','salario','income',true,true),(null,'Aluguel recebido','aluguel-recebido','income',true,true),(null,'Rendimentos','rendimentos','income',true,true),
 (null,'Reembolso','reembolso','income',true,true),(null,'Venda','venda','income',true,true),(null,'Outras receitas','outras-receitas','income',true,true),
 (null,'Moradia','moradia','expense',true,true),(null,'Alimentação','alimentacao','expense',true,true),(null,'Transporte','transporte','expense',true,true),
 (null,'Saúde','saude','expense',true,true),(null,'Educação','educacao','expense',true,true),(null,'Filhos','filhos','expense',true,true),
 (null,'Lazer','lazer','expense',true,true),(null,'Viagens','viagens','expense',true,true),(null,'Assinaturas','assinaturas','expense',true,true),
 (null,'Impostos','impostos','expense',true,true),(null,'Seguros','seguros','expense',true,true),(null,'Compras','compras','expense',true,true),
 (null,'Dívidas','dividas','expense',true,true),(null,'Outros','outros','expense',true,true)
on conflict do nothing;

create or replace function public.refresh_financial_account(target uuid)
returns void language sql security definer set search_path=''
as $$ update public.financial_accounts a set current_balance=a.opening_balance+
 coalesce((select sum(case when t.account_id=target and t.transaction_type in ('income','refund','reversal') then t.amount when t.account_id=target and t.transaction_type='expense' then -t.amount when t.account_id=target and t.transaction_type='transfer' then -t.amount when t.destination_account_id=target and t.transaction_type='transfer' then t.amount else 0 end) from public.financial_transactions t where t.status='realized' and (t.account_id=target or t.destination_account_id=target)),0), balance_updated_at=now() where a.id=target $$;
create or replace function public.after_financial_transaction()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
 if tg_op<>'INSERT' then perform public.refresh_financial_account(old.account_id); if old.destination_account_id is not null then perform public.refresh_financial_account(old.destination_account_id); end if; end if;
 if tg_op<>'DELETE' then perform public.refresh_financial_account(new.account_id); if new.destination_account_id is not null then perform public.refresh_financial_account(new.destination_account_id); end if; end if;
 return coalesce(new,old); end $$;
create trigger financial_transactions_balance after insert or update or delete on public.financial_transactions for each row execute function public.after_financial_transaction();

grant select,insert,update,delete on public.financial_categories,public.financial_accounts,public.financial_transactions,public.credit_cards,public.card_invoices,public.card_purchases,public.recurring_rules,public.installment_plans,public.bank_connections to authenticated;
