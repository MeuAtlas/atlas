alter table public.profiles
  add column if not exists is_super_admin boolean not null default false,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'suspended'));

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  icon text,
  route text,
  category text not null default 'personal',
  is_default boolean not null default false,
  is_globally_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_modules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  enabled boolean not null default true,
  permission_level text not null default 'owner' check (permission_level in ('owner','admin','editor','viewer')),
  enabled_by uuid references auth.users(id) on delete set null,
  enabled_at timestamptz,
  disabled_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, module_id)
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  type text not null default 'personal' check (type in ('personal','couple','family','project')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')),
  status text not null default 'active' check (status in ('invited','active','suspended','left')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table public.workspace_modules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, module_id)
);

create index user_modules_user_idx on public.user_modules(user_id, enabled);
create index workspace_members_user_idx on public.workspace_members(user_id, status);
create index workspace_modules_workspace_idx on public.workspace_modules(workspace_id, enabled);

do $$ declare table_name text; begin
  foreach table_name in array array['modules','user_modules','workspaces','workspace_members','workspace_modules'] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

insert into public.modules (slug,name,description,icon,route,category,is_default) values
 ('financeiro','Financeiro','Contas, cartões, movimentações e planejamento.','wallet','/financeiro','personal',true),
 ('agenda','Agenda','Compromissos e eventos.','calendar',null,'personal',false),
 ('documentos','Documentos','Arquivos e documentos pessoais.','file',null,'personal',false),
 ('saude','Saúde','Informações pessoais de saúde.','heart',null,'personal',false),
 ('objetivos','Objetivos','Metas e evolução pessoal.','target',null,'personal',false),
 ('familia','Família','Organização familiar.','users',null,'shared',false),
 ('viagens','Viagens','Planejamento de viagens.','plane',null,'personal',false),
 ('patrimonio','Patrimônio','Bens e patrimônio.','building',null,'personal',false),
 ('tarefas','Tarefas','Tarefas e projetos.','check','/tarefas','personal',false),
 ('automacoes','Automações','Rotinas automáticas.','sparkles',null,'system',false),
 ('escala-piloto','Escala de Piloto','Módulo profissional especializado.','plane',null,'professional',false),
 ('controle-emprestimos','Controle de Empréstimos','Módulo profissional especializado.','briefcase',null,'professional',false)
on conflict (slug) do update set name=excluded.name, description=excluded.description, icon=excluded.icon,
 route=excluded.route, category=excluded.category, is_default=excluded.is_default;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.workspace_members where workspace_id=target_workspace and user_id=auth.uid() and status='active') $$;

create or replace function public.can_edit_workspace(target_workspace uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.workspace_members where workspace_id=target_workspace and user_id=auth.uid() and status='active' and role in ('owner','admin','editor')) $$;

create or replace function public.can_admin_workspace(target_workspace uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.workspace_members where workspace_id=target_workspace and user_id=auth.uid() and status='active' and role in ('owner','admin')) $$;

revoke all on function public.is_workspace_member(uuid), public.can_edit_workspace(uuid), public.can_admin_workspace(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid), public.can_edit_workspace(uuid), public.can_admin_workspace(uuid) to authenticated;

alter table public.modules enable row level security;
alter table public.user_modules enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_modules enable row level security;

create policy modules_read on public.modules for select to authenticated using (is_globally_active or public.is_super_admin());
create policy modules_admin on public.modules for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy user_modules_read on public.user_modules for select to authenticated using (user_id=auth.uid() or public.is_super_admin());
create policy user_modules_admin on public.user_modules for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy workspaces_read on public.workspaces for select to authenticated using (owner_id=auth.uid() or public.is_workspace_member(id) or public.is_super_admin());
create policy workspaces_insert on public.workspaces for insert to authenticated with check (owner_id=auth.uid());
create policy workspaces_update on public.workspaces for update to authenticated using (public.can_admin_workspace(id)) with check (public.can_admin_workspace(id));
create policy workspace_members_read on public.workspace_members for select to authenticated using (user_id=auth.uid() or public.is_workspace_member(workspace_id) or public.is_super_admin());
create policy workspace_members_admin on public.workspace_members for all to authenticated using (public.can_admin_workspace(workspace_id) or public.is_super_admin()) with check (public.can_admin_workspace(workspace_id) or public.is_super_admin());
create policy workspace_modules_read on public.workspace_modules for select to authenticated using (public.is_workspace_member(workspace_id) or public.is_super_admin());
create policy workspace_modules_admin on public.workspace_modules for all to authenticated using (public.can_admin_workspace(workspace_id) or public.is_super_admin()) with check (public.can_admin_workspace(workspace_id) or public.is_super_admin());

create policy profiles_super_admin_read on public.profiles for select to authenticated using (public.is_super_admin());
create policy profiles_super_admin_update on public.profiles for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  if auth.uid() is not null and not public.is_super_admin() then
    new.is_super_admin := old.is_super_admin;
    new.status := old.status;
  end if;
  return new;
end $$;
create trigger profiles_protect_privileges before update on public.profiles for each row execute function public.protect_profile_privileges();

create or replace function public.sync_super_admin_profile()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  update public.profiles set is_super_admin=(new.role='super_admin' and new.revoked_at is null) where id=new.user_id;
  return new;
end $$;
create trigger system_roles_sync_profile after insert or update on public.system_user_roles for each row execute function public.sync_super_admin_profile();
update public.profiles p set is_super_admin=true where exists(select 1 from public.system_user_roles r where r.user_id=p.id and r.role='super_admin' and r.revoked_at is null);

create or replace function public.provision_atlas_user(target_user uuid, target_name text default null)
returns void language plpgsql security definer set search_path=''
as $$ declare ws uuid; begin
  insert into public.profiles(id,full_name) values(target_user,target_name) on conflict(id) do nothing;
  insert into public.workspaces(owner_id,name,slug,type) values(target_user,'Meu Atlas','meu-atlas','personal')
  on conflict(owner_id,slug) do update set name=excluded.name returning id into ws;
  insert into public.workspace_members(workspace_id,user_id,role,status,joined_at) values(ws,target_user,'owner','active',now()) on conflict(workspace_id,user_id) do nothing;
  insert into public.user_modules(user_id,module_id,enabled,permission_level,enabled_at)
    select target_user,id,true,'owner',now() from public.modules where is_default and is_globally_active on conflict(user_id,module_id) do nothing;
  insert into public.workspace_modules(workspace_id,module_id,enabled)
    select ws,id,true from public.modules where is_default and is_globally_active on conflict(workspace_id,module_id) do nothing;
end $$;

do $$ declare u record; begin for u in select id,raw_user_meta_data->>'full_name' full_name from auth.users loop perform public.provision_atlas_user(u.id,u.full_name); end loop; end $$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path=''
as $$ begin perform public.provision_atlas_user(new.id,new.raw_user_meta_data->>'full_name'); return new; end $$;

create or replace function public.admin_set_user_module(target_user uuid, target_module text, target_enabled boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  insert into public.user_modules(user_id,module_id,enabled,permission_level,enabled_by,enabled_at,disabled_at)
  select target_user,id,target_enabled,'owner',auth.uid(),case when target_enabled then now() end,case when not target_enabled then now() end from public.modules where slug=target_module
  on conflict(user_id,module_id) do update set enabled=excluded.enabled,enabled_by=auth.uid(),enabled_at=case when target_enabled then now() else public.user_modules.enabled_at end,disabled_at=case when target_enabled then null else now() end;
end $$;
revoke all on function public.admin_set_user_module(uuid,text,boolean) from public,anon;
grant execute on function public.admin_set_user_module(uuid,text,boolean) to authenticated;

create or replace function public.admin_set_workspace_module(target_workspace uuid, target_module text, target_enabled boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  insert into public.workspace_modules(workspace_id,module_id,enabled)
  select target_workspace,id,target_enabled from public.modules where slug=target_module
  on conflict(workspace_id,module_id) do update set enabled=excluded.enabled;
end $$;
revoke all on function public.admin_set_workspace_module(uuid,text,boolean) from public,anon;
grant execute on function public.admin_set_workspace_module(uuid,text,boolean) to authenticated;

grant select,insert,update,delete on public.modules,public.user_modules,public.workspaces,public.workspace_members,public.workspace_modules to authenticated;
