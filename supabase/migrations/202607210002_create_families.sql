create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'suspended', 'left')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);

create table if not exists public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  invited_email text not null check (char_length(trim(invited_email)) between 3 and 320),
  invited_by uuid not null references auth.users(id) on delete cascade,
  invited_user_id uuid references auth.users(id) on delete set null,
  role text not null default 'member' check (role in ('admin', 'member')),
  token_hash text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'revoked', 'expired')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  rejected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists families_created_by_idx on public.families(created_by);
create index if not exists family_members_user_id_idx on public.family_members(user_id);
create index if not exists family_members_family_id_idx on public.family_members(family_id);
create unique index if not exists family_members_one_active_family_per_user_idx
  on public.family_members(user_id)
  where status = 'active';
create index if not exists family_invitations_family_id_idx on public.family_invitations(family_id);
create index if not exists family_invitations_invited_email_idx on public.family_invitations(lower(invited_email));
create index if not exists family_invitations_invited_user_id_idx on public.family_invitations(invited_user_id);
create index if not exists family_invitations_status_idx on public.family_invitations(status);
create unique index if not exists family_invitations_token_hash_idx
  on public.family_invitations(token_hash)
  where token_hash is not null;

drop trigger if exists families_set_updated_at on public.families;
create trigger families_set_updated_at
before update on public.families
for each row execute function public.set_updated_at();

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invitations enable row level security;

revoke all on public.families from anon;
revoke all on public.family_members from anon;
revoke all on public.family_invitations from anon;

