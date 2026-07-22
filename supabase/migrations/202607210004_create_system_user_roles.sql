create table if not exists public.system_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin', 'system_admin', 'support_admin')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists system_user_roles_set_updated_at on public.system_user_roles;
create trigger system_user_roles_set_updated_at
before update on public.system_user_roles
for each row execute function public.set_updated_at();

alter table public.system_user_roles enable row level security;

revoke all on public.system_user_roles from anon, authenticated;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.system_user_roles
    where user_id = auth.uid()
      and role = 'super_admin'
      and revoked_at is null
  );
$$;

create or replace function public.get_my_system_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.system_user_roles
  where user_id = auth.uid()
    and revoked_at is null
  limit 1;
$$;

revoke all on function public.is_super_admin() from public, anon, authenticated;
revoke all on function public.get_my_system_role() from public, anon, authenticated;

grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.get_my_system_role() to authenticated;
