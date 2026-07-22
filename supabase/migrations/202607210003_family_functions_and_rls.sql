create or replace function public.current_family_role(p_family_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.family_members as member
  where member.family_id = p_family_id
    and member.user_id = auth.uid()
    and member.status = 'active'
  limit 1;
$$;

create or replace function public.is_active_family_member(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_family_role(p_family_id) is not null;
$$;

create or replace function public.can_manage_family(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_family_role(p_family_id) in ('owner', 'admin'), false);
$$;

create or replace function public.guard_family_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'FAMILY_CREATOR_IMMUTABLE';
  end if;

  actor_role := public.current_family_role(old.id);
  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'FAMILY_MANAGEMENT_FORBIDDEN';
  end if;

  if new.archived_at is distinct from old.archived_at and actor_role <> 'owner' then
    raise exception 'ONLY_OWNER_CAN_ARCHIVE_FAMILY';
  end if;

  return new;
end;
$$;

drop trigger if exists families_guard_update on public.families;
create trigger families_guard_update
before update on public.families
for each row execute function public.guard_family_update();

create or replace function public.guard_family_member_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  operation text := current_setting('atlas.member_operation', true);
  other_owner_count integer;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if tg_op = 'INSERT' then
    if operation = 'create_family'
      and new.user_id = actor_id
      and new.role = 'owner'
      and new.status = 'active'
      and exists (
        select 1 from public.families
        where id = new.family_id and created_by = actor_id
      ) then
      return new;
    end if;

    if operation = 'accept_invitation'
      and new.user_id = actor_id
      and new.role in ('admin', 'member')
      and new.status = 'active' then
      return new;
    end if;

    actor_role := public.current_family_role(new.family_id);
    if actor_role = 'owner' and new.role in ('admin', 'member') then
      return new;
    end if;
    if actor_role = 'admin' and new.role = 'member' then
      return new;
    end if;

    raise exception 'MEMBER_MANAGEMENT_FORBIDDEN';
  end if;

  if new.family_id is distinct from old.family_id or new.user_id is distinct from old.user_id then
    raise exception 'MEMBER_IDENTITY_IMMUTABLE';
  end if;

  if operation = 'leave_family'
    and old.user_id = actor_id
    and new.status = 'left'
    and new.role = old.role then
    if old.role = 'owner' and old.status = 'active' then
      select count(*) into other_owner_count
      from public.family_members
      where family_id = old.family_id
        and role = 'owner'
        and status = 'active'
        and user_id <> actor_id;

      if other_owner_count = 0 then
        raise exception 'ONLY_OWNER_CANNOT_LEAVE';
      end if;
    end if;
    return new;
  end if;

  actor_role := public.current_family_role(old.family_id);
  if actor_role = 'owner' and old.role <> 'owner' and new.role in ('admin', 'member') then
    return new;
  end if;
  if actor_role = 'admin' and old.role = 'member' and new.role = 'member' then
    return new;
  end if;

  raise exception 'MEMBER_HIERARCHY_VIOLATION';
end;
$$;

drop trigger if exists family_members_guard_write on public.family_members;
create trigger family_members_guard_write
before insert or update on public.family_members
for each row execute function public.guard_family_member_write();

drop policy if exists families_select_active_members on public.families;
create policy families_select_active_members
on public.families
for select
to authenticated
using (public.is_active_family_member(id));

drop policy if exists families_insert_creator on public.families;
create policy families_insert_creator
on public.families
for insert
to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists families_update_managers on public.families;
create policy families_update_managers
on public.families
for update
to authenticated
using (public.can_manage_family(id))
with check (public.can_manage_family(id));

drop policy if exists family_members_select_same_family on public.family_members;
create policy family_members_select_same_family
on public.family_members
for select
to authenticated
using (public.is_active_family_member(family_id));

drop policy if exists family_members_insert_managers on public.family_members;
create policy family_members_insert_managers
on public.family_members
for insert
to authenticated
with check (public.can_manage_family(family_id));

drop policy if exists family_members_update_managers on public.family_members;
create policy family_members_update_managers
on public.family_members
for update
to authenticated
using (public.can_manage_family(family_id))
with check (public.can_manage_family(family_id));

drop policy if exists family_invitations_select_authorized on public.family_invitations;
create policy family_invitations_select_authorized
on public.family_invitations
for select
to authenticated
using (
  invited_by = (select auth.uid())
  or invited_user_id = (select auth.uid())
  or public.can_manage_family(family_id)
  or lower(trim(invited_email)) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
);

drop policy if exists family_invitations_insert_managers on public.family_invitations;
create policy family_invitations_insert_managers
on public.family_invitations
for insert
to authenticated
with check (
  invited_by = (select auth.uid())
  and public.can_manage_family(family_id)
  and (
    role = 'member'
    or public.current_family_role(family_id) = 'owner'
  )
);

create or replace function public.create_family(family_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_name text := trim(family_name);
  new_family_id uuid;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if normalized_name is null or char_length(normalized_name) not between 2 and 120 then
    raise exception 'INVALID_FAMILY_NAME';
  end if;
  if exists (
    select 1 from public.family_members
    where user_id = actor_id and status = 'active'
  ) then
    raise exception 'ALREADY_IN_ACTIVE_FAMILY';
  end if;

  insert into public.families (name, created_by)
  values (normalized_name, actor_id)
  returning id into new_family_id;

  perform set_config('atlas.member_operation', 'create_family', true);
  insert into public.family_members (family_id, user_id, role, status)
  values (new_family_id, actor_id, 'owner', 'active');

  return new_family_id;
end;
$$;

create or replace function public.accept_family_invitation(invitation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  invitation public.family_invitations%rowtype;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select lower(email) into actor_email from auth.users where id = actor_id;
  select * into invitation
  from public.family_invitations
  where id = invitation_id
  for update;

  if not found then
    raise exception 'INVITATION_NOT_AVAILABLE';
  end if;
  if not coalesce(
    invitation.invited_user_id = actor_id
    or (
      invitation.invited_user_id is null
      and actor_email is not null
      and lower(trim(invitation.invited_email)) = actor_email
    ),
    false
  ) then
    raise exception 'INVITATION_NOT_AVAILABLE';
  end if;
  if invitation.status <> 'pending' then
    return 'not_pending';
  end if;
  if invitation.expires_at <= now() then
    update public.family_invitations set status = 'expired' where id = invitation.id;
    return 'expired';
  end if;
  if exists (
    select 1 from public.family_members
    where user_id = actor_id and status = 'active'
  ) then
    raise exception 'ALREADY_IN_ACTIVE_FAMILY';
  end if;
  if not exists (
    select 1 from public.families
    where id = invitation.family_id and archived_at is null
  ) then
    raise exception 'FAMILY_NOT_AVAILABLE';
  end if;

  perform set_config('atlas.member_operation', 'accept_invitation', true);
  insert into public.family_members (family_id, user_id, role, status)
  values (invitation.family_id, actor_id, invitation.role, 'active');

  update public.family_invitations
  set status = 'accepted', accepted_at = now(), invited_user_id = actor_id
  where id = invitation.id;

  return 'accepted';
end;
$$;

create or replace function public.reject_family_invitation(invitation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  invitation public.family_invitations%rowtype;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select lower(email) into actor_email from auth.users where id = actor_id;
  select * into invitation
  from public.family_invitations
  where id = invitation_id
  for update;

  if not found then
    raise exception 'INVITATION_NOT_AVAILABLE';
  end if;
  if not coalesce(
    invitation.invited_user_id = actor_id
    or (
      invitation.invited_user_id is null
      and actor_email is not null
      and lower(trim(invitation.invited_email)) = actor_email
    ),
    false
  ) then
    raise exception 'INVITATION_NOT_AVAILABLE';
  end if;
  if invitation.status <> 'pending' then
    return 'not_pending';
  end if;
  if invitation.expires_at <= now() then
    update public.family_invitations set status = 'expired' where id = invitation.id;
    return 'expired';
  end if;

  update public.family_invitations
  set status = 'rejected', rejected_at = now(), invited_user_id = actor_id
  where id = invitation.id;

  return 'rejected';
end;
$$;

create or replace function public.revoke_family_invitation(invitation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invitation public.family_invitations%rowtype;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into invitation
  from public.family_invitations
  where id = invitation_id
  for update;

  if not found or not (
    invitation.invited_by = actor_id
    or public.can_manage_family(invitation.family_id)
  ) then
    raise exception 'INVITATION_NOT_AVAILABLE';
  end if;
  if invitation.status <> 'pending' then
    return 'not_pending';
  end if;

  update public.family_invitations
  set status = 'revoked', revoked_at = now()
  where id = invitation.id;

  return 'revoked';
end;
$$;

create or replace function public.leave_family()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  membership public.family_members%rowtype;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into membership
  from public.family_members
  where user_id = actor_id and status = 'active'
  for update;

  if not found then
    return 'not_in_family';
  end if;

  perform set_config('atlas.member_operation', 'leave_family', true);
  update public.family_members
  set status = 'left'
  where id = membership.id;

  return 'left';
end;
$$;

revoke all on public.families from authenticated;
revoke all on public.family_members from authenticated;
revoke all on public.family_invitations from authenticated;

grant select, update on public.families to authenticated;
grant select, insert, update on public.family_members to authenticated;
grant select (
  id, family_id, invited_email, invited_by, invited_user_id, role, status,
  expires_at, accepted_at, rejected_at, revoked_at, created_at
) on public.family_invitations to authenticated;
grant insert on public.family_invitations to authenticated;

revoke all on function public.current_family_role(uuid) from public, anon;
revoke all on function public.is_active_family_member(uuid) from public, anon;
revoke all on function public.can_manage_family(uuid) from public, anon;
revoke all on function public.create_family(text) from public, anon;
revoke all on function public.accept_family_invitation(uuid) from public, anon;
revoke all on function public.reject_family_invitation(uuid) from public, anon;
revoke all on function public.revoke_family_invitation(uuid) from public, anon;
revoke all on function public.leave_family() from public, anon;
revoke all on function public.guard_family_update() from public, anon;
revoke all on function public.guard_family_member_write() from public, anon;

grant execute on function public.current_family_role(uuid) to authenticated;
grant execute on function public.is_active_family_member(uuid) to authenticated;
grant execute on function public.can_manage_family(uuid) to authenticated;
grant execute on function public.create_family(text) to authenticated;
grant execute on function public.accept_family_invitation(uuid) to authenticated;
grant execute on function public.reject_family_invitation(uuid) to authenticated;
grant execute on function public.revoke_family_invitation(uuid) to authenticated;
grant execute on function public.leave_family() to authenticated;
