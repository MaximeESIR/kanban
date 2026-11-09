begin;
-- Each correction keeps the previous report and creates one independently leased turn.
-- Session identifiers never come from the browser: the PC resolves its own receipt.
alter table public.development_runs
 add column parent_run_id uuid references public.development_runs(id),
 add column correction text check(length(correction) between 1 and 8000);
create unique index one_correction_per_run on public.development_runs(parent_run_id) where parent_run_id is not null;
alter table public.development_runs add constraint correction_has_parent check
 ((parent_run_id is null) = (correction is null));
create function public.request_development_correction(p_id uuid,p_run uuid,p_version timestamptz,p_feedback text)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.development_runs; existing public.development_runs;
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 if p_feedback is null or length(btrim(p_feedback)) not between 1 and 8000 then raise exception 'Décrivez la correction (1 à 8000 caractères)'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 select * into existing from public.development_runs where id=p_id and owner_id=auth.uid();
 if found then
  if existing.parent_run_id is distinct from p_run or existing.correction is distinct from btrim(p_feedback) then raise exception 'Cette demande a déjà un autre contenu'; end if;
  return p_id;
 end if;
 select * into previous from public.development_runs where id=p_run and owner_id=auth.uid() for update;
 if not found or previous.status<>'review' then raise exception 'Aucun résultat à corriger'; end if;
 -- submit_development enforces version, prerequisites, presence, quota, catalogue and ownership.
 -- Any failure rolls back the old status too, leaving the review available.
 update public.development_runs set status='cancelled',phase='Correction demandée' where id=p_run;
 perform public.submit_development(p_id,previous.ticket_id,p_version,previous.codex_model,previous.reasoning_effort);
 if not exists(select 1 from public.development_runs where id=p_id and repository_id=previous.repository_id and worker_id=previous.worker_id) then
  raise exception 'Le dépôt ou le PC a changé ; impossible de reprendre cette session';
 end if;
 update public.development_runs set parent_run_id=p_run,correction=btrim(p_feedback),phase='Correction en attente du PC' where id=p_id;
 return p_id;
end; $$;
revoke all on function public.request_development_correction(uuid,uuid,timestamptz,text) from public,anon;
grant execute on function public.request_development_correction(uuid,uuid,timestamptz,text) to authenticated;
create or replace function public.atelier_schema_version() returns integer language sql stable set search_path='' as $$ select case when public.can_access_atelier() then 11 else 0 end; $$;
commit;
