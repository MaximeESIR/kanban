begin;
-- Mandatory second factor for human accounts, enforced in every existing RLS policy.
create or replace function public.can_access_atelier() returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce(auth.jwt()->>'aal','') = 'aal2' and exists(select 1 from private.atelier_owners where user_id=auth.uid());
$$;
alter table public.notes drop constraint notes_content_check;
alter table public.notes add constraint notes_content_check check (char_length(content)<=2000000);

alter table public.notes add column category text not null default 'pro' check(category in ('pro','perso'));
alter table public.tickets add column position double precision not null default 0 check(position > '-Infinity'::float8 and position < 'Infinity'::float8);

-- A worker has a separate Auth account, no owner-table access, no administrative key.
create table private.workers (
 user_id uuid primary key references auth.users on delete cascade,
 owner_id uuid not null references private.atelier_owners(user_id) on delete cascade,
 label text not null default 'Mon PC', capabilities text[] not null default '{}', last_seen timestamptz,
 enabled boolean not null default true
);
revoke all on private.workers from public,anon,authenticated;
create table public.ai_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users on delete cascade,
 kind text not null check(kind in ('summarize','rewrite','transcribe','search')),
 input jsonb not null check(octet_length(input::text)<=6000000),
 status text not null default 'queued' check(status in ('queued','running','done','failed','cancelled')),
 context jsonb not null default '{}', result jsonb, error text, worker_id uuid references auth.users on delete set null,
 lease uuid, created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz
);
alter table public.ai_jobs enable row level security;
revoke all on public.ai_jobs from public,anon,authenticated;
grant select on public.ai_jobs to authenticated;
create policy jobs_read on public.ai_jobs for select to authenticated using(owner_id=auth.uid() and public.can_access_atelier());
create index jobs_owner on public.ai_jobs(owner_id,created_at desc);
create index jobs_pending on public.ai_jobs(status,created_at);

create function public.pc_status() returns table(label text, capabilities text[], last_seen timestamptz) language sql stable security definer set search_path='' as $$
 select label,capabilities,last_seen from private.workers where owner_id=auth.uid() and enabled and public.can_access_atelier();
$$;
create function public.submit_job(p_id uuid,p_kind text,p_input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 -- Serialize per-owner quotas, including concurrent requests.
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 if exists(select 1 from public.ai_jobs where id=p_id and owner_id=auth.uid()) then return p_id; end if;
 if not exists(select 1 from private.workers where owner_id=auth.uid() and enabled and last_seen>now()-interval '45 seconds' and p_kind=any(capabilities)) then raise exception 'PC indisponible pour ce traitement'; end if;
 if (select count(*) from public.ai_jobs where owner_id=auth.uid() and status in ('queued','running'))>=5 then raise exception '5 demandes sont déjà en attente'; end if;
 if (select count(*) from public.ai_jobs where owner_id=auth.uid() and created_at>now()-interval '1 hour')>=60 then raise exception 'Limite de 60 demandes par heure'; end if;
 if jsonb_typeof(p_input)<>'object' then raise exception 'Entrée invalide'; end if;
 insert into public.ai_jobs(id,owner_id,kind,input,context) values(p_id,auth.uid(),p_kind,p_input,coalesce(p_input->'context','{}')); 
 return p_id;
end; $$;
create function public.cancel_job(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 update public.ai_jobs set status='cancelled',input='{}',lease=null,finished_at=now() where id=p_id and owner_id=auth.uid() and status in ('queued','running');
end; $$;
create function public.worker_poll(p_capabilities text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.workers; j public.ai_jobs;
begin
 select * into w from private.workers where user_id=auth.uid() and enabled for update;
 if not found then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 if not p_capabilities <@ array['summarize','rewrite','transcribe','search']::text[] then raise exception 'Capacité interdite'; end if;
 update private.workers set last_seen=now(),capabilities=p_capabilities where user_id=w.user_id;
 -- A crashed or timed-out operation is never silently re-executed.
 update public.ai_jobs set status='failed',error='Traitement interrompu ou expiré. Vous pouvez réessayer.',input='{}',lease=null,finished_at=now()
 where owner_id=w.owner_id and ((status='running' and started_at<now()-interval '5 minutes') or (status='queued' and created_at<now()-interval '10 minutes'));
 delete from public.ai_jobs where owner_id=w.owner_id and finished_at<now()-interval '7 days';
 if exists(select 1 from public.ai_jobs where worker_id=w.user_id and status='running') then return null; end if;
 select * into j from public.ai_jobs where owner_id=w.owner_id and status='queued' and kind=any(p_capabilities) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.ai_jobs set status='running',worker_id=w.user_id,lease=gen_random_uuid(),started_at=now() where id=j.id returning * into j;
 return to_jsonb(j);
end; $$;
create function public.worker_finish(p_id uuid,p_lease uuid,p_result jsonb,p_error text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not exists(select 1 from private.workers where user_id=auth.uid() and enabled) then raise exception 'Worker non autorisé' using errcode='42501'; end if;
 if octet_length(p_result::text)>2000000 or char_length(p_error)>500 then raise exception 'Résultat trop grand'; end if;
 update public.ai_jobs set status=case when p_error is null then 'done' else 'failed' end,result=p_result,error=p_error,input='{}',lease=null,finished_at=now()
 where id=p_id and owner_id=(select owner_id from private.workers where user_id=auth.uid() and enabled) and worker_id=auth.uid() and lease=p_lease and status='running' and started_at>now()-interval '5 minutes';
 get diagnostics n=row_count; return n=1;
end; $$;

-- Idempotent, version-checked offline writes. The private receipt survives retries.
create table private.sync_receipts(owner_id uuid references auth.users on delete cascade,id uuid,response jsonb,primary key(owner_id,id));
revoke all on private.sync_receipts from public,anon,authenticated;
create function public.sync_write(p_request uuid,p_table text,p_id uuid,p_base timestamptz,p_delete boolean,p_values jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare old jsonb; response jsonb; cols text; assignments text; t text; allowed text[];
begin
 if not public.can_access_atelier() then raise exception 'Accès refusé' using errcode='42501'; end if;
 if p_table not in ('notes','projects','tickets') then raise exception 'Table interdite'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 select r.response into response from private.sync_receipts r where owner_id=auth.uid() and id=p_request;
 if found then return response; end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 and owner_id=$2 for update',p_table) into old using p_id,auth.uid();
 if (old is not null and (p_base is null or (old->>'updated_at')::timestamptz<>p_base)) or (old is null and p_base is not null and not p_delete) then
   response=jsonb_build_object('conflict',true,'remote_version',old->'updated_at');
 elsif p_delete then
   execute format('delete from public.%I where id=$1 and owner_id=$2',p_table) using p_id,auth.uid();
   response=jsonb_build_object('deleted',true);
 else
   p_values=coalesce(old,'{}'::jsonb)||p_values;
   if p_table='notes' then p_values=jsonb_build_object('category','pro')||p_values; end if;
   if p_table='tickets' then p_values=jsonb_build_object('position',0)||p_values; end if;
   allowed=case p_table when 'notes' then array['title','content','category'] when 'projects' then array['name','description','color'] else array['project_id','title','description','status','priority','difficulty','depends_on_id','position'] end;
   select string_agg(format('%I',x),','),string_agg(format('%I=v.%I',x,x),',') into cols,assignments from unnest(allowed) x;
   if old is null then
     execute format('insert into public.%I (id,owner_id,%s) select $1,$2,%s from jsonb_populate_record(null::public.%I,$3) v returning to_jsonb(%I.*)',p_table,cols,cols,p_table,p_table) into response using p_id,auth.uid(),p_values;
   else
     execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$3) v where t.id=$1 and t.owner_id=$2 returning to_jsonb(t.*)',p_table,assignments,p_table) into response using p_id,auth.uid(),p_values;
   end if;
   response=jsonb_build_object('row',jsonb_build_object('id',p_id,'owner_id',auth.uid(),'updated_at',response->'updated_at') || case when p_table='tickets' then jsonb_build_object('number',response->'number') else '{}'::jsonb end);
 end if;
 insert into private.sync_receipts values(auth.uid(),p_request,response);
 return response;
end; $$;
revoke all on function public.pc_status(), public.submit_job(uuid,text,jsonb), public.cancel_job(uuid),public.worker_poll(text[]),public.worker_finish(uuid,uuid,jsonb,text),public.sync_write(uuid,text,uuid,timestamptz,boolean,jsonb) from public,anon;
grant execute on function public.pc_status(), public.submit_job(uuid,text,jsonb), public.cancel_job(uuid),public.worker_poll(text[]),public.worker_finish(uuid,uuid,jsonb,text),public.sync_write(uuid,text,uuid,timestamptz,boolean,jsonb) to authenticated;
commit;
