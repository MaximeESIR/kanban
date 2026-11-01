begin;
-- Existing RLS and read-only grants remain in force. Only the PC advertises its catalogue.
alter table public.worker_repositories add column codex_models jsonb not null default '[]';
alter table public.development_runs add column codex_model text, add column reasoning_effort text;
alter table public.development_runs add constraint valid_codex_selection check (
 (codex_model is null and reasoning_effort is null) or
 (codex_model is not null and reasoning_effort is not null and codex_model ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'
  and reasoning_effort in ('low','medium','high','xhigh','max'))
);
create function private.valid_codex_models(p_models jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare m jsonb; seen text[] := '{}';
begin
 if jsonb_typeof(p_models) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_models)>50 or octet_length(p_models::text)>50000 then return false; end if;
 for m in select value from jsonb_array_elements(p_models) loop
  if jsonb_typeof(m) is distinct from 'object' then return false; end if;
  if m - array['id','label','efforts','default_effort'] <> '{}'::jsonb then return false; end if;
  if jsonb_typeof(m->'id') is distinct from 'string' or not (m->>'id' ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$') or m->>'id'=any(seen) then return false; end if;
  if jsonb_typeof(m->'label') is distinct from 'string' or length(m->>'label') not between 1 and 100 then return false; end if;
  if jsonb_typeof(m->'efforts') is distinct from 'array' then return false; end if;
  if jsonb_array_length(m->'efforts') not between 1 and 5 then return false; end if;
  if exists(select 1 from jsonb_array_elements(m->'efforts') e where jsonb_typeof(e)<>'string' or e#>>'{}' not in ('low','medium','high','xhigh','max')) then return false; end if;
  if jsonb_typeof(m->'default_effort') is distinct from 'string' or not ((m->'efforts') ? (m->>'default_effort')) then return false; end if;
  seen=array_append(seen,m->>'id');
 end loop;
 return true;
end; $$;
revoke all on function private.valid_codex_models(jsonb) from public,anon,authenticated;
create or replace function public.worker_repository_sync(p_repositories jsonb) returns void language plpgsql security definer set search_path='' as $$
declare w private.workers; r jsonb;
begin
 select * into w from private.workers where user_id=auth.uid() and enabled for update;
 if not found then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 if jsonb_typeof(p_repositories)<>'array' or jsonb_array_length(p_repositories)>50 then raise exception 'Registre invalide'; end if;
 update public.worker_repositories set enabled=false where worker_id=w.user_id and id not in (select (value->>'id')::uuid from jsonb_array_elements(p_repositories));
 for r in select value from jsonb_array_elements(p_repositories) loop
  if exists(select 1 from public.worker_repositories where id=(r->>'id')::uuid and worker_id<>w.user_id) then raise exception 'Dépôt non autorisé'; end if;
  if not private.valid_codex_models(coalesce(r->'codex_models','[]')) then raise exception 'Catalogue Codex invalide'; end if;
  insert into public.worker_repositories(id,owner_id,worker_id,label,local_path,enabled,codex_models)
   values((r->>'id')::uuid,w.owner_id,w.user_id,r->>'label',r->>'path',coalesce((r->>'enabled')::boolean,false),coalesce(r->'codex_models','[]'))
   on conflict(id) do update set label=excluded.label,local_path=excluded.local_path,enabled=excluded.enabled,codex_models=excluded.codex_models,last_seen=now();
 end loop;
end; $$;
drop function public.submit_development(uuid,uuid,timestamptz);
create function public.submit_development(p_id uuid,p_ticket uuid,p_version timestamptz,p_model text default null,p_effort text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.tickets; r public.worker_repositories;
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 if exists(select 1 from public.development_runs where id=p_id and owner_id=auth.uid() and ticket_id=p_ticket) then
  if not exists(select 1 from public.development_runs where id=p_id and codex_model=p_model and reasoning_effort=p_effort) then raise exception 'Cette exécution a déjà un autre réglage'; end if;
  return p_id;
 end if;
 select * into t from public.tickets where id=p_ticket and owner_id=auth.uid() for update;
 if not found or t.updated_at is distinct from p_version then raise exception 'Actualisez et enregistrez le ticket avant Run'; end if;
 if t.status='done' then raise exception 'Ce ticket est déjà terminé'; end if;
 if exists(select 1 from public.tickets where id=any(t.prerequisite_ids) and status<>'done') then raise exception 'Terminez les prérequis avant Run'; end if;
 select r0.* into r from public.worker_repositories r0 join public.project_repositories b on b.repository_id=r0.id join private.workers w on w.user_id=r0.worker_id
 where b.project_id=t.project_id and r0.enabled and w.enabled and w.last_seen>now()-interval '45 seconds';
 if not found then raise exception 'Dépôt ou PC indisponible'; end if;
 if not exists(select 1 from jsonb_array_elements(r.codex_models) m where m->>'id'=p_model and (m->'efforts') ? p_effort) then raise exception 'Choisissez un modèle et un effort proposés par le PC ; actualisez Atelier'; end if;
 if (select count(*) from public.development_runs where owner_id=auth.uid() and status in ('queued','running'))>=20 then raise exception '20 exécutions sont déjà en attente'; end if;
 if (select count(*) from public.development_runs where owner_id=auth.uid() and created_at>now()-interval '1 hour')>=60 then raise exception 'Limite de 60 exécutions par heure'; end if;
 insert into public.development_runs(id,owner_id,project_id,ticket_id,repository_id,worker_id,ticket_version,ticket_snapshot,codex_model,reasoning_effort)
 values(p_id,auth.uid(),t.project_id,t.id,r.id,r.worker_id,t.updated_at,to_jsonb(t),p_model,p_effort);
 return p_id;
end; $$;
revoke all on function public.submit_development(uuid,uuid,timestamptz,text,text) from public,anon;
grant execute on function public.submit_development(uuid,uuid,timestamptz,text,text) to authenticated;
create or replace function public.atelier_schema_version() returns integer language sql stable set search_path='' as $$ select case when public.can_access_atelier() then 6 else 0 end; $$;
commit;
