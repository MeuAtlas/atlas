-- Provisioning is called by the auth trigger. It must not accept arbitrary user ids from clients.
revoke all on function public.provision_atlas_user(uuid, text) from public, anon, authenticated;

-- Keep the profile mirror aligned when a super-admin role is revoked or removed.
create or replace function public.sync_super_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid := coalesce(new.user_id, old.user_id);
begin
  update public.profiles
  set is_super_admin = exists (
    select 1 from public.system_user_roles
    where user_id = target_user
      and role = 'super_admin'
      and revoked_at is null
  )
  where id = target_user;
  return coalesce(new, old);
end;
$$;

drop trigger if exists system_roles_sync_profile on public.system_user_roles;
create trigger system_roles_sync_profile
after insert or update or delete on public.system_user_roles
for each row execute function public.sync_super_admin_profile();
