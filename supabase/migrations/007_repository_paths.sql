begin;
-- An authenticated human requests one exact PC path. The PC validates it before binding.
create table public.repository_requests (
 id uuid primary key, owner_id uuid not null references auth.users on delete cascade,
 project_id uuid not null, worker_id uuid not null references private.workers(user_id) on delete cascade,
 requested_path text not null check(length(requested_path) between 1 and 1000),
 create_if_missing boolean not null default false,
 status text not null default 'queued' check(status in ('queued','checking','ready','failed','cancelled')),
 lease uuid, repository_id uuid references public.worker_repositories(id) on delete set null,
 error text check(length(error)<=500), created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 foreign key(project_id,owner_id) references public.projects(id,owner_id) on delete cascade
);
create unique index one_repository_request on public.repository_requests(project_id) where status in ('queued','checking');
create index repository_requests_queue on public.repository_requests(worker_id,created_at) where status in ('queued','checking');
alter table public.repository_requests enable row level security;
revoke all on public.repository_requests from public,anon,authenticated;
grant select on public.repository_requests to authenticated;
create policy repository_requests_read on public.repository_requests for select to authenticated using(owner_id=auth.uid() and public.can_access_atelier());
create trigger notify_repository_requests after insert or update or delete on public.repository_requests for each row execute function private.atelier_change('repositories');
create trigger notify_repository_queue after insert or update of status on public.repository_requests for each row execute function private.atelier_change('jobs');

create function public.repository_pcs() returns table(id uuid,label text,last_seen timestamptz) language sql stable security definer set search_path='' as $$
 select user_id,label,last_seen from private.workers where owner_id=auth.uid() and enabled and public.can_access_atelier() order by label,user_id;
$$;
create function public.request_repository(p_id uuid,p_project uuid,p_worker uuid,p_path text,p_create boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.repository_requests;
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 perform 1 from public.projects where id=p_project and owner_id=auth.uid() for update;
 if not found then raise exception 'Projet inaccessible'; end if;
 if p_create is null then raise exception 'Choisissez le mode du dépôt'; end if;
 if p_path is null or length(p_path) not between 1 and 1000 or p_path !~ '^(/|~/)' or p_path ~ '[[:cntrl:]]' then raise exception 'Saisissez un chemin absolu du PC, par exemple /home/vous/projet'; end if;
 if not exists(select 1 from private.workers where user_id=p_worker and owner_id=auth.uid() and enabled) then raise exception 'PC inaccessible'; end if;
 select * into previous from public.repository_requests where id=p_id and owner_id=auth.uid();
 if found then
  if previous.project_id<>p_project or previous.worker_id<>p_worker or previous.requested_path<>p_path or previous.create_if_missing is distinct from p_create then raise exception 'Cette demande existe avec un autre chemin'; end if;
  return p_id;
 end if;
 if exists(select 1 from public.development_runs where project_id=p_project and status in ('queued','running','review')) then raise exception 'Terminez ou annulez les exécutions avant de changer de dépôt'; end if;
 if (select count(*) from public.repository_requests where owner_id=auth.uid() and status in ('queued','checking'))>=5 then raise exception '5 vérifications de dépôts sont déjà en attente'; end if;
 if (select count(*) from public.repository_requests where owner_id=auth.uid() and created_at>now()-interval '1 hour')>=30 then raise exception 'Limite de 30 vérifications par heure'; end if;
 update public.repository_requests set status='cancelled',lease=null,finished_at=now() where project_id=p_project and status in ('queued','checking');
 insert into public.repository_requests(id,owner_id,project_id,worker_id,requested_path,create_if_missing) values(p_id,auth.uid(),p_project,p_worker,p_path,p_create);
 return p_id;
end; $$;
create function public.cancel_repository_request(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 update public.repository_requests set status='cancelled',lease=null,finished_at=now() where id=p_id and owner_id=auth.uid() and status in ('queued','checking');
end; $$;
create function public.worker_repository_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workers; j public.repository_requests;
begin
 select * into w from private.workers where user_id=auth.uid() and enabled for update;
 if not found then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 -- Validation is repeatable; it never starts Codex or changes the source repository.
 update public.repository_requests set status='failed',lease=null,error='Demande expirée. Saisissez à nouveau le chemin.',finished_at=now() where worker_id=w.user_id and status in ('queued','checking') and created_at<now()-interval '1 day';
 select * into j from public.repository_requests where worker_id=w.user_id and (status='queued' or (status='checking' and started_at<now()-interval '60 seconds')) order by created_at for update skip locked limit 1;
 if not found then
  if exists(select 1 from public.repository_requests where worker_id=w.user_id and status='checking') then return jsonb_build_object('retry_after',65); end if;
  return null;
 end if;
 update public.repository_requests set status='checking',lease=gen_random_uuid(),started_at=now() where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('label',(select name from public.projects where id=j.project_id));
end; $$;
create function public.worker_repository_finish(p_id uuid,p_lease uuid,p_repository uuid,p_error text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.repository_requests; owner uuid;
begin
 owner=public.atelier_worker_owner();
 if owner is null then return false; end if;
 perform 1 from private.atelier_owners where user_id=owner for update;
 select * into j from public.repository_requests where id=p_id and worker_id=auth.uid() and owner_id=owner for update;
 if not found then return false; end if;
 if j.status='ready' and j.repository_id=p_repository then return true; end if;
 if j.status<>'checking' or j.lease is distinct from p_lease or j.started_at<now()-interval '60 seconds' then return false; end if;
 perform 1 from public.projects where id=j.project_id for update;
 if exists(select 1 from public.development_runs where project_id=j.project_id and status in ('queued','running','review')) then
  p_error='Une exécution est active. Terminez-la puis réessayez.';
 end if;
 if p_error is not null then
  update public.repository_requests set status='failed',lease=null,error=left(p_error,500),finished_at=now() where id=p_id;
  return true;
 end if;
 if p_repository is null or not exists(select 1 from public.worker_repositories where id=p_repository and owner_id=owner and worker_id=auth.uid()) then raise exception 'Dépôt non vérifié par ce PC'; end if;
 insert into public.project_repositories(project_id,owner_id,repository_id) values(j.project_id,owner,p_repository) on conflict(project_id) do update set repository_id=excluded.repository_id;
 update public.repository_requests set status='ready',lease=null,repository_id=p_repository,finished_at=now() where id=p_id;
 return true;
end; $$;
-- Choosing an existing repository supersedes any pending path request.
create or replace function public.bind_project_repository(p_project uuid,p_repository uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 perform 1 from public.projects where id=p_project and owner_id=auth.uid() for update;
 if not found then raise exception 'Projet inaccessible'; end if;
 if exists(select 1 from public.development_runs where project_id=p_project and status in ('queued','running','review')) then raise exception 'Terminez ou annulez les exécutions avant de changer de dépôt'; end if;
 if p_repository is not null and not exists(select 1 from public.worker_repositories where id=p_repository and owner_id=auth.uid()) then raise exception 'Dépôt inaccessible'; end if;
 update public.repository_requests set status='cancelled',lease=null,finished_at=now() where project_id=p_project and status in ('queued','checking');
 if p_repository is null then delete from public.project_repositories where project_id=p_project; return; end if;
 insert into public.project_repositories values(p_project,auth.uid(),p_repository) on conflict(project_id) do update set repository_id=excluded.repository_id;
end; $$;
revoke all on function public.repository_pcs(),public.request_repository(uuid,uuid,uuid,text,boolean),public.cancel_repository_request(uuid),public.worker_repository_claim(),public.worker_repository_finish(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.repository_pcs(),public.request_repository(uuid,uuid,uuid,text,boolean),public.cancel_repository_request(uuid),public.worker_repository_claim(),public.worker_repository_finish(uuid,uuid,uuid,text) to authenticated;
create or replace function public.atelier_schema_version() returns integer language sql stable set search_path='' as $$ select case when public.can_access_atelier() then 7 else 0 end; $$;
commit;
