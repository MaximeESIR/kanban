-- Run once in the SQL editor of a NEW Supabase project.
-- This migration deliberately grants no anonymous access and requires an
-- administrator-managed allowlist in addition to ordinary user isolation.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.atelier_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.atelier_owners from public, anon, authenticated;

create function public.can_access_atelier()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from private.atelier_owners where user_id = (select auth.uid())); $$;
revoke all on function public.can_access_atelier() from public, anon;
grant execute on function public.can_access_atelier() to authenticated;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  color text not null default 'sage' check (color in ('sage','blue','purple','peach','rose','sand')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, owner_id)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null,
  number bigint generated always as identity,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 12000),
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard','complex')),
  depends_on_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, project_id, owner_id),
  foreign key(project_id, owner_id) references public.projects(id, owner_id) on delete cascade,
  foreign key(depends_on_id, project_id, owner_id) references public.tickets(id, project_id, owner_id) on delete set null (depends_on_id),
  check (depends_on_id is null or depends_on_id <> id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 160),
  content text not null default '' check (char_length(content) <= 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_idx on public.projects(owner_id);
create index tickets_owner_project_idx on public.tickets(owner_id, project_id);
create index tickets_dependency_idx on public.tickets(depends_on_id);
create index notes_owner_updated_idx on public.notes(owner_id, updated_at desc);

alter table public.projects enable row level security;
alter table public.tickets enable row level security;
alter table public.notes enable row level security;

revoke all on public.projects, public.tickets, public.notes from public, anon, authenticated;
revoke all on sequence public.tickets_number_seq from public, anon, authenticated;
grant select, insert, update, delete on public.projects, public.tickets, public.notes to authenticated;
grant usage on sequence public.tickets_number_seq to authenticated;

create policy projects_read on public.projects for select to authenticated using (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy projects_create on public.projects for insert to authenticated with check (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy projects_update on public.projects for update to authenticated using (owner_id = (select auth.uid()) and (select public.can_access_atelier())) with check (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy projects_delete on public.projects for delete to authenticated using (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy tickets_read on public.tickets for select to authenticated using (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy tickets_create on public.tickets for insert to authenticated with check (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy tickets_update on public.tickets for update to authenticated using (owner_id = (select auth.uid()) and (select public.can_access_atelier())) with check (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy tickets_delete on public.tickets for delete to authenticated using (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy notes_read on public.notes for select to authenticated using (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy notes_create on public.notes for insert to authenticated with check (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy notes_update on public.notes for update to authenticated using (owner_id = (select auth.uid()) and (select public.can_access_atelier())) with check (owner_id = (select auth.uid()) and (select public.can_access_atelier()));
create policy notes_delete on public.notes for delete to authenticated using (owner_id = (select auth.uid()) and (select public.can_access_atelier()));

create function private.touch_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id <> old.owner_id then
    raise exception 'Le propriétaire ne peut pas être modifié.';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_record() from public, anon, authenticated;
create trigger projects_touch before update on public.projects for each row execute function private.touch_record();
create trigger tickets_touch before update on public.tickets for each row execute function private.touch_record();
create trigger notes_touch before update on public.notes for each row execute function private.touch_record();

create function private.check_ticket_dependency()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and (new.project_id <> old.project_id or new.number <> old.number) then
    raise exception 'Le projet et le numéro du ticket ne peuvent pas être modifiés.';
  end if;
  if new.depends_on_id is null then return new; end if;
  -- Serialize dependency edits within one project, including concurrent clients.
  perform 1 from public.projects where id = new.project_id and owner_id = new.owner_id for update;
  if exists (
    with recursive chain as (
      select id, depends_on_id from public.tickets where id = new.depends_on_id and project_id = new.project_id and owner_id = new.owner_id
      union
      select t.id, t.depends_on_id from public.tickets t join chain c on t.id = c.depends_on_id
      where t.project_id = new.project_id and t.owner_id = new.owner_id
    ) select 1 from chain where id = new.id
  ) then raise exception 'Cette dépendance créerait une boucle entre les tickets.'; end if;
  return new;
end;
$$;
revoke all on function private.check_ticket_dependency() from public, anon, authenticated;
create trigger tickets_dependency before insert or update on public.tickets for each row execute function private.check_ticket_dependency();

commit;
