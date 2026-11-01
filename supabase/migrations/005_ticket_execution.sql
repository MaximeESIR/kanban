begin;
-- Only metadata notifications are replicated. Payloads remain behind scoped RPCs.
create function public.atelier_worker_owner() returns uuid language sql stable security definer set search_path='' as $$
 select owner_id from private.workers where user_id=auth.uid() and enabled;
$$;
revoke all on function public.atelier_worker_owner() from public,anon;
grant execute on function public.atelier_worker_owner() to authenticated;
create table public.atelier_events (
 owner_id uuid not null references auth.users on delete cascade,
 kind text not null check(kind in ('jobs','workspace','runs','repositories')),
 revision bigint not null default 1,
 primary key(owner_id,kind)
);
alter table public.atelier_events enable row level security;
revoke all on public.atelier_events from public,anon,authenticated;
grant select on public.atelier_events to authenticated;
create policy events_read on public.atelier_events for select to authenticated using
 ((owner_id=auth.uid() and public.can_access_atelier()) or (kind='jobs' and owner_id=public.atelier_worker_owner()));
create function private.atelier_notify(p_owner uuid,p_kind text) returns void language sql security definer set search_path='' as $$
 insert into public.atelier_events(owner_id,kind) select p_owner,p_kind from auth.users where id=p_owner
 on conflict(owner_id,kind) do update set revision=public.atelier_events.revision+1;
$$;
create function private.atelier_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.atelier_notify(coalesce(new.owner_id,old.owner_id),tg_argv[0]);
 return null;
end; $$;
create trigger notify_projects after insert or update or delete on public.projects for each row execute function private.atelier_change('workspace');
create trigger notify_tickets after insert or update or delete on public.tickets for each row execute function private.atelier_change('workspace');
create trigger notify_notes after insert or update or delete on public.notes for each row execute function private.atelier_change('workspace');
create trigger notify_ai after insert or update on public.ai_jobs for each row execute function private.atelier_change('jobs');

create table public.worker_repositories (
 id uuid primary key, owner_id uuid not null references auth.users on delete cascade,
 worker_id uuid not null references private.workers(user_id) on delete cascade,
 label text not null check(length(label) between 1 and 100),
 local_path text not null check(length(local_path) between 1 and 1000),
 enabled boolean not null default false, last_seen timestamptz not null default now(),
 unique(id,owner_id)
);
create table public.project_repositories (
 project_id uuid primary key, owner_id uuid not null,
 repository_id uuid not null,
 foreign key(project_id,owner_id) references public.projects(id,owner_id) on delete cascade,
 foreign key(repository_id,owner_id) references public.worker_repositories(id,owner_id) on delete cascade
);
create table public.development_runs (
 id uuid primary key, owner_id uuid not null references auth.users on delete cascade,
 project_id uuid not null, ticket_id uuid not null,
 repository_id uuid not null references public.worker_repositories(id),
 worker_id uuid not null references private.workers(user_id),
 status text not null default 'queued' check(status in ('queued','running','review','approved','failed','cancelled')),
 ticket_version timestamptz not null, ticket_snapshot jsonb not null,
 phase text not null default 'En attente' check(length(phase)<=200),
 result jsonb, error text check(length(error)<=500), lease uuid,
 created_at timestamptz not null default now(), started_at timestamptz, heartbeat_at timestamptz, finished_at timestamptz,
 foreign key(ticket_id,project_id,owner_id) references public.tickets(id,project_id,owner_id) on delete cascade
);
create unique index one_active_ticket on public.development_runs(ticket_id) where status in ('queued','running','review');
create unique index one_session_per_worker on public.development_runs(worker_id) where status='running';
create index runs_owner_created on public.development_runs(owner_id,created_at desc);
create index runs_queue on public.development_runs(worker_id,created_at) where status='queued';
alter table public.worker_repositories enable row level security;
alter table public.project_repositories enable row level security;
alter table public.development_runs enable row level security;
revoke all on public.worker_repositories,public.project_repositories,public.development_runs from public,anon,authenticated;
grant select on public.worker_repositories,public.project_repositories,public.development_runs to authenticated;
create policy repositories_read on public.worker_repositories for select to authenticated using(owner_id=auth.uid() and public.can_access_atelier());
create policy bindings_read on public.project_repositories for select to authenticated using(owner_id=auth.uid() and public.can_access_atelier());
create policy runs_read on public.development_runs for select to authenticated using(owner_id=auth.uid() and public.can_access_atelier());
create trigger notify_repositories after insert or update or delete on public.worker_repositories for each row execute function private.atelier_change('repositories');
create trigger notify_bindings after insert or update or delete on public.project_repositories for each row execute function private.atelier_change('repositories');
create trigger notify_runs after insert or update or delete on public.development_runs for each row execute function private.atelier_change('runs');
create trigger notify_run_queue after insert or update of status on public.development_runs for each row execute function private.atelier_change('jobs');

create function public.worker_repository_sync(p_repositories jsonb) returns void language plpgsql security definer set search_path='' as $$
declare w private.workers; r jsonb;
begin
 select * into w from private.workers where user_id=auth.uid() and enabled for update;
 if not found then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 if jsonb_typeof(p_repositories)<>'array' or jsonb_array_length(p_repositories)>50 then raise exception 'Registre invalide'; end if;
 update public.worker_repositories set enabled=false where worker_id=w.user_id and id not in (select (value->>'id')::uuid from jsonb_array_elements(p_repositories));
 for r in select value from jsonb_array_elements(p_repositories) loop
  if exists(select 1 from public.worker_repositories where id=(r->>'id')::uuid and worker_id<>w.user_id) then raise exception 'Dépôt non autorisé'; end if;
  insert into public.worker_repositories(id,owner_id,worker_id,label,local_path,enabled)
   values((r->>'id')::uuid,w.owner_id,w.user_id,r->>'label',r->>'path',coalesce((r->>'enabled')::boolean,false))
   on conflict(id) do update set label=excluded.label,local_path=excluded.local_path,enabled=excluded.enabled,last_seen=now();
 end loop;
end; $$;
create function public.bind_project_repository(p_project uuid,p_repository uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 perform 1 from public.projects where id=p_project and owner_id=auth.uid() for update;
 if not found then raise exception 'Projet inaccessible'; end if;
 if exists(select 1 from public.development_runs where project_id=p_project and status in ('queued','running','review')) then raise exception 'Terminez ou annulez les exécutions avant de changer de dépôt'; end if;
 if p_repository is null then delete from public.project_repositories where project_id=p_project; return; end if;
 if not exists(select 1 from public.worker_repositories where id=p_repository and owner_id=auth.uid()) then raise exception 'Dépôt inaccessible'; end if;
 insert into public.project_repositories values(p_project,auth.uid(),p_repository)
 on conflict(project_id) do update set repository_id=excluded.repository_id;
end; $$;
create function public.submit_development(p_id uuid,p_ticket uuid,p_version timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.tickets; r public.worker_repositories;
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 if exists(select 1 from public.development_runs where id=p_id and owner_id=auth.uid() and ticket_id=p_ticket) then return p_id; end if;
 select * into t from public.tickets where id=p_ticket and owner_id=auth.uid() for update;
 if not found or t.updated_at is distinct from p_version then raise exception 'Actualisez et enregistrez le ticket avant Run'; end if;
 if t.status='done' then raise exception 'Ce ticket est déjà terminé'; end if;
 if exists(select 1 from public.tickets where id=any(t.prerequisite_ids) and status<>'done') then raise exception 'Terminez les prérequis avant Run'; end if;
 select r0.* into r from public.worker_repositories r0 join public.project_repositories b on b.repository_id=r0.id join private.workers w on w.user_id=r0.worker_id
 where b.project_id=t.project_id and r0.enabled and w.enabled and w.last_seen>now()-interval '45 seconds';
 if not found then raise exception 'Dépôt ou PC indisponible'; end if;
 if (select count(*) from public.development_runs where owner_id=auth.uid() and status in ('queued','running'))>=20 then raise exception '20 exécutions sont déjà en attente'; end if;
 if (select count(*) from public.development_runs where owner_id=auth.uid() and created_at>now()-interval '1 hour')>=60 then raise exception 'Limite de 60 exécutions par heure'; end if;
 insert into public.development_runs(id,owner_id,project_id,ticket_id,repository_id,worker_id,ticket_version,ticket_snapshot)
 values(p_id,auth.uid(),t.project_id,t.id,r.id,r.worker_id,t.updated_at,to_jsonb(t));
 return p_id;
end; $$;
create function public.cancel_development(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 update public.development_runs set status='cancelled',phase='Annulée',lease=null,finished_at=now() where id=p_id and owner_id=auth.uid() and status in ('queued','running','review');
end; $$;
create function public.worker_development_claim(p_repositories uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workers; j public.development_runs; t public.tickets;
begin
 select * into w from private.workers where user_id=auth.uid() and enabled for update;
 if not found then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 update public.development_runs set status='failed',phase='Interrompue',lease=null,error='Session interrompue ou expirée. Vérifiez les changements locaux avant de relancer.',finished_at=now()
 where worker_id=w.user_id and ((status='running' and heartbeat_at<now()-interval '90 seconds') or (status='queued' and created_at<now()-interval '1 day'));
 if exists(select 1 from public.development_runs where worker_id=w.user_id and status='running') then return null; end if;
 loop
  select * into j from public.development_runs where worker_id=w.user_id and status='queued' and repository_id=any(p_repositories) order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  select * into t from public.tickets where id=j.ticket_id for update;
  if not exists(select 1 from public.project_repositories where project_id=j.project_id and repository_id=j.repository_id) or t.updated_at is distinct from j.ticket_version or t.status='done' or exists(select 1 from public.tickets where id=any(t.prerequisite_ids) and status<>'done') or not exists(select 1 from public.worker_repositories where id=j.repository_id and enabled and worker_id=w.user_id) then
   update public.development_runs set status='failed',error='Le ticket, ses prérequis ou son dépôt ont changé. Vérifiez puis relancez.',phase='À vérifier',finished_at=now() where id=j.id;
   continue;
  end if;
  update public.tickets set status='in_progress' where id=t.id returning * into t;
  update public.development_runs set status='running',lease=gen_random_uuid(),started_at=now(),heartbeat_at=now(),ticket_version=t.updated_at,phase='Examen du dépôt' where id=j.id returning * into j;
  return to_jsonb(j)||jsonb_build_object('project_name',(select name from public.projects where id=j.project_id),'related_tickets',(select coalesce(jsonb_agg(jsonb_build_object('number',number,'title',title,'status',status,'description',description)),'[]') from public.tickets where id=any(t.prerequisite_ids) or id=t.parent_id));
 end loop;
end; $$;
create function public.worker_development_pulse(p_id uuid,p_lease uuid,p_phase text) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 update public.development_runs set heartbeat_at=now(),phase=left(p_phase,200)
 where id=p_id and worker_id=auth.uid() and owner_id=public.atelier_worker_owner() and lease=p_lease and status='running' and heartbeat_at>now()-interval '90 seconds' and started_at>now()-interval '1 hour'
 and exists(select 1 from public.worker_repositories where id=repository_id and enabled);
 get diagnostics n=row_count;return n=1;
end; $$;
create function public.worker_development_finish(p_id uuid,p_lease uuid,p_result jsonb,p_error text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>40000 then raise exception 'Compte rendu invalide'; end if;
 if p_result ? 'summary' and jsonb_typeof(p_result->'summary')<>'string' then raise exception 'Résumé invalide'; end if;
 if (p_result ? 'tests' and jsonb_typeof(p_result->'tests')<>'array') or (p_result ? 'limitations' and jsonb_typeof(p_result->'limitations')<>'array') then raise exception 'Vérifications invalides'; end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_result->'tests','[]')||coalesce(p_result->'limitations','[]')) e where jsonb_typeof(e)<>'string') then raise exception 'Vérifications invalides'; end if;
 if (p_result ? 'branch' and jsonb_typeof(p_result->'branch')<>'string') or (p_result ? 'worktree' and jsonb_typeof(p_result->'worktree')<>'string') or (p_result ? 'changes' and jsonb_typeof(p_result->'changes')<>'string') then raise exception 'Détails invalides'; end if;
 update public.development_runs set status=case when p_error is null then 'review' else 'failed' end,phase=case when p_error is null then 'À valider' else 'À vérifier' end,result=p_result,error=left(p_error,500),lease=null,finished_at=now()
 where id=p_id and worker_id=auth.uid() and owner_id=public.atelier_worker_owner() and lease=p_lease and status='running' and heartbeat_at>now()-interval '90 seconds' and started_at>now()-interval '1 hour';
 get diagnostics n=row_count;return n=1;
end; $$;
create function public.approve_development(p_id uuid,p_version timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare j public.development_runs; t public.tickets;
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 select * into j from public.development_runs where id=p_id and owner_id=auth.uid() for update;
 if not found or j.status<>'review' then raise exception 'Aucun résultat à valider'; end if;
 select * into t from public.tickets where id=j.ticket_id for update;
 if t.updated_at is distinct from p_version then raise exception 'Le ticket a changé. Actualisez avant de valider'; end if;
 if exists(select 1 from public.tickets where id=any(t.prerequisite_ids) and status<>'done') then raise exception 'Des prérequis restent ouverts'; end if;
 update public.tickets set status='done' where id=t.id;
 update public.development_runs set status='approved',phase='Validée par vous' where id=j.id;
end; $$;
-- Presence also expires abandoned sessions; it never starts or claims another task.
create or replace function public.worker_heartbeat(p_capabilities text[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_capabilities is null or not p_capabilities <@ array['summarize','rewrite','transcribe','search']::text[] then raise exception 'Capacité interdite'; end if;
 update private.workers set last_seen=now(),capabilities=p_capabilities where user_id=auth.uid() and enabled;
 if not found then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 update public.development_runs set status='failed',phase='Interrompue',lease=null,error='Session interrompue ou expirée. Vérifiez le travail local avant de relancer.',finished_at=now()
 where worker_id=auth.uid() and ((status='running' and heartbeat_at<now()-interval '90 seconds') or (status='queued' and created_at<now()-interval '1 day'));
end; $$;
-- Avoid bypassing completion review while Codex is still writing.
create function private.guard_active_run() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='done' and old.status<>'done' and exists(select 1 from public.development_runs where ticket_id=new.id and status in ('queued','running')) then raise exception 'Annulez ou attendez la session Codex avant de terminer ce ticket'; end if;
 return new;
end; $$;
create trigger guard_active_run before update on public.tickets for each row execute function private.guard_active_run();
-- A manual drag/status change to Done is also explicit human validation.
create function private.approve_manual_done() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='done' and old.status<>'done' and new.owner_id=auth.uid() and public.can_access_atelier() then
  update public.development_runs set status='approved',phase='Validée par vous' where ticket_id=new.id and status='review';
 end if;
 return null;
end; $$;
create trigger approve_manual_done after update on public.tickets for each row execute function private.approve_manual_done();
revoke all on function private.approve_manual_done() from public,anon,authenticated;
revoke all on function public.worker_repository_sync(jsonb), public.bind_project_repository(uuid,uuid),public.submit_development(uuid,uuid,timestamptz),public.cancel_development(uuid),public.worker_development_claim(uuid[]),public.worker_development_pulse(uuid,uuid,text),public.worker_development_finish(uuid,uuid,jsonb,text),public.approve_development(uuid,timestamptz) from public,anon;
grant execute on function public.worker_repository_sync(jsonb), public.bind_project_repository(uuid,uuid),public.submit_development(uuid,uuid,timestamptz),public.cancel_development(uuid),public.worker_development_claim(uuid[]),public.worker_development_pulse(uuid,uuid,text),public.worker_development_finish(uuid,uuid,jsonb,text),public.approve_development(uuid,timestamptz) to authenticated;
revoke all on function private.atelier_notify(uuid,text),private.atelier_change(),private.guard_active_run() from public,anon,authenticated;
create or replace function public.atelier_schema_version() returns integer language sql stable set search_path='' as $$ select case when public.can_access_atelier() then 5 else 0 end; $$;
-- Supabase has this publication; local PostgreSQL tests need no logical replication.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.atelier_events;
 end if;
end $$;
commit;
