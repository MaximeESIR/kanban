begin;
-- A human explicitly chooses the destination of future note/audio requests.
-- API secrets never enter this database. Workers report only readiness metadata.
create table private.assistant_preferences (
 owner_id uuid primary key references private.atelier_owners(user_id) on delete cascade,
 provider text not null default 'local' check(provider in ('local','groq')),
 revision bigint not null default 0 check(revision>=0)
);
alter table private.assistant_preferences enable row level security;
revoke all on private.assistant_preferences from public,anon,authenticated;
alter table private.workers
 add column assistant_provider text check(assistant_provider in ('local','groq')),
 add column assistant_revision bigint not null default -1,
 add column assistant_state text not null default 'pending' check(assistant_state in ('pending','ready','blocked')),
 add column groq_configured boolean not null default false,
 add column local_models_unloaded boolean not null default false,
 add column assistant_error text check(length(assistant_error)<=500);
alter table public.ai_jobs add column provider text not null default 'local' check(provider in ('local','groq'));

create function public.assistant_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare preferred text; rev bigint; pcs jsonb;
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 select provider,revision into preferred,rev from private.assistant_preferences where owner_id=auth.uid();
 preferred=coalesce(preferred,'local');rev=coalesce(rev,0);
 select coalesce(jsonb_agg(jsonb_build_object('label',w.label,'last_seen',w.last_seen,
  'provider',w.assistant_provider,'revision',w.assistant_revision,
  'state',case when w.assistant_revision<>rev or w.assistant_provider is distinct from preferred then 'pending' else w.assistant_state end,
  'groq_configured',w.groq_configured,'local_models_unloaded',w.local_models_unloaded,'error',w.assistant_error) order by w.label,w.user_id),'[]'::jsonb)
 into pcs from private.workers w where w.owner_id=auth.uid() and w.enabled;
 return jsonb_build_object('provider',preferred,'revision',rev,'pcs',pcs);
end; $$;
create function public.set_assistant_provider(p_provider text) returns void language plpgsql security definer set search_path='' as $$
declare previous text;
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 if p_provider is null or p_provider not in ('local','groq') then raise exception 'Choisissez Local ou Groq'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 select provider into previous from private.assistant_preferences where owner_id=auth.uid();
 if coalesce(previous,'local')=p_provider then return; end if;
 if exists(select 1 from public.ai_jobs where owner_id=auth.uid() and status in ('queued','running')) then
  raise exception 'Attendez la fin des demandes de l’assistant ou annulez-les avant de changer de moteur';
 end if;
 insert into private.assistant_preferences(owner_id,provider,revision) values(auth.uid(),p_provider,1)
 on conflict(owner_id) do update set provider=excluded.provider,revision=private.assistant_preferences.revision+1;
 perform private.atelier_notify(auth.uid(),'jobs');
end; $$;
create function public.worker_assistant_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner uuid; result jsonb;
begin
 owner=public.atelier_worker_owner();
 if owner is null then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 select jsonb_build_object('provider',provider,'revision',revision) into result from private.assistant_preferences where owner_id=owner;
 return coalesce(result,jsonb_build_object('provider','local','revision',0));
end; $$;
create function public.worker_assistant_report(p_revision bigint,p_provider text,p_state text,p_groq_configured boolean,p_local_models_unloaded boolean,p_error text default null,p_capabilities text[] default '{}') returns boolean language plpgsql security definer set search_path='' as $$
declare owner uuid; preferred text; rev bigint; changed integer;
begin
 owner=public.atelier_worker_owner();
 if owner is null then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 if p_revision is null or p_revision<0 or p_provider is null or p_provider not in ('local','groq') or p_state is null or p_state not in ('ready','pending','blocked') or p_groq_configured is null or p_local_models_unloaded is null or length(p_error)>500 then raise exception 'État du moteur invalide'; end if;
 if p_capabilities is null or not p_capabilities <@ array['summarize','rewrite','transcribe','search']::text[] or (p_state='ready' and cardinality(p_capabilities)=0) or (p_state<>'ready' and cardinality(p_capabilities)>0) then raise exception 'Capacités incohérentes avec le moteur'; end if;
 if p_state='ready' and p_provider='groq' and (not p_groq_configured or not p_local_models_unloaded) then raise exception 'Groq requiert une clé configurée et les moteurs locaux déchargés'; end if;
 perform 1 from private.atelier_owners where user_id=owner for update;
 select provider,revision into preferred,rev from private.assistant_preferences where owner_id=owner;
 if coalesce(preferred,'local')<>p_provider or coalesce(rev,0)<>p_revision then return false; end if;
 update private.workers set assistant_provider=p_provider,assistant_revision=p_revision,assistant_state=p_state,
  groq_configured=p_groq_configured,local_models_unloaded=p_local_models_unloaded,assistant_error=p_error,capabilities=p_capabilities
 where user_id=auth.uid() and enabled and
  (assistant_provider,assistant_revision,assistant_state,groq_configured,local_models_unloaded,assistant_error,capabilities)
  is distinct from (p_provider,p_revision,p_state,p_groq_configured,p_local_models_unloaded,p_error,p_capabilities);
 get diagnostics changed=row_count;
 if changed>0 then perform private.atelier_notify(owner,'jobs'); end if;
 return true;
end; $$;
create or replace function public.pc_status() returns table(label text, capabilities text[], last_seen timestamptz) language sql stable security definer set search_path='' as $$
 select w.label,case when w.assistant_state='ready' and w.assistant_revision=coalesce(p.revision,0) and w.assistant_provider=coalesce(p.provider,'local') then w.capabilities else '{}'::text[] end,w.last_seen
 from private.workers w left join private.assistant_preferences p on p.owner_id=w.owner_id
 where w.owner_id=auth.uid() and w.enabled and public.can_access_atelier();
$$;
-- Default 'local' preserves old clients without authorizing cloud uploads silently.
drop function public.submit_job(uuid,text,jsonb);
create function public.submit_job(p_id uuid,p_kind text,p_input jsonb,p_provider text default 'local') returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.ai_jobs; preferred text; rev bigint;
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 if p_provider is null or p_provider not in ('local','groq') then raise exception 'Moteur invalide'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 select * into previous from public.ai_jobs where id=p_id and owner_id=auth.uid();
 if found then
  if previous.provider<>p_provider or previous.kind<>p_kind then raise exception 'Cette demande existe avec un autre moteur ou traitement'; end if;
  return p_id;
 end if;
 select provider,revision into preferred,rev from private.assistant_preferences where owner_id=auth.uid();
 if p_provider<>coalesce(preferred,'local') then raise exception 'Le moteur a changé. Actualisez avant d’envoyer votre demande'; end if;
 if not exists(select 1 from private.workers where owner_id=auth.uid() and enabled and last_seen>now()-interval '45 seconds' and p_kind=any(capabilities)
  and assistant_state='ready' and assistant_provider=p_provider and assistant_revision=coalesce(rev,0)) then raise exception 'PC indisponible ou changement de moteur en attente'; end if;
 if (select count(*) from public.ai_jobs where owner_id=auth.uid() and status in ('queued','running'))>=5 then raise exception '5 demandes sont déjà en attente'; end if;
 if (select count(*) from public.ai_jobs where owner_id=auth.uid() and created_at>now()-interval '1 hour')>=60 then raise exception 'Limite de 60 demandes par heure'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Entrée invalide'; end if;
 insert into public.ai_jobs(id,owner_id,kind,input,context,provider) values(p_id,auth.uid(),p_kind,p_input,coalesce(p_input->'context','{}'),p_provider);
 return p_id;
end; $$;
drop function public.worker_poll(text[]);
create function public.worker_poll(p_capabilities text[],p_provider text default 'local') returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workers; j public.ai_jobs; owner uuid; preferred text; rev bigint;
begin
 owner=public.atelier_worker_owner();
 if owner is null then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 perform 1 from private.atelier_owners where user_id=owner for update;
 select * into w from private.workers where user_id=auth.uid() and enabled for update;
 if not found then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 if p_capabilities is null or not p_capabilities <@ array['summarize','rewrite','transcribe','search']::text[] or p_provider is null or p_provider not in ('local','groq') then raise exception 'Capacité ou moteur interdit'; end if;
 update private.workers set last_seen=now(),capabilities=p_capabilities where user_id=w.user_id;
 update public.ai_jobs set status='failed',error='Traitement interrompu ou expiré. Vous pouvez réessayer.',input='{}',lease=null,finished_at=now()
 where owner_id=w.owner_id and ((status='running' and started_at<now()-interval '5 minutes') or (status='queued' and created_at<now()-interval '10 minutes'));
 delete from public.ai_jobs where owner_id=w.owner_id and finished_at<now()-interval '7 days';
 select provider,revision into preferred,rev from private.assistant_preferences where owner_id=owner;
 if w.assistant_state<>'ready' or w.assistant_revision<>coalesce(rev,0) or w.assistant_provider is distinct from p_provider or p_provider<>coalesce(preferred,'local') then return null; end if;
 if exists(select 1 from public.ai_jobs where worker_id=w.user_id and status='running') then return null; end if;
 select * into j from public.ai_jobs where owner_id=w.owner_id and status='queued' and provider=p_provider and kind=any(p_capabilities) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.ai_jobs set status='running',worker_id=w.user_id,lease=gen_random_uuid(),started_at=now() where id=j.id returning * into j;
 return to_jsonb(j);
end; $$;
revoke all on function public.assistant_settings(),public.set_assistant_provider(text),public.worker_assistant_settings(),public.worker_assistant_report(bigint,text,text,boolean,boolean,text,text[]),public.submit_job(uuid,text,jsonb,text),public.worker_poll(text[],text) from public,anon;
grant execute on function public.assistant_settings(),public.set_assistant_provider(text),public.worker_assistant_settings(),public.worker_assistant_report(bigint,text,text,boolean,boolean,text,text[]),public.submit_job(uuid,text,jsonb,text),public.worker_poll(text[],text) to authenticated;
create or replace function public.atelier_schema_version() returns integer language sql stable set search_path='' as $$ select case when public.can_access_atelier() then 8 else 0 end; $$;
commit;
