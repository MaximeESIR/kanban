begin;
-- 008 is reserved for the optional Groq experiment. This migration depends on 001-007.
-- MCP accounts are neither human owners nor PC workers; each project is allowed explicitly.
create table private.ticket_agents (
 user_id uuid primary key references auth.users on delete cascade,
 owner_id uuid not null references private.atelier_owners(user_id) on delete cascade,
 label text not null check(length(btrim(label)) between 1 and 100),
 enabled boolean not null default true,
 unique(user_id,owner_id), check(user_id<>owner_id)
);
create table private.ticket_agent_projects (
 agent_id uuid not null, project_id uuid not null, owner_id uuid not null,
 primary key(agent_id,project_id),
 foreign key(agent_id,owner_id) references private.ticket_agents(user_id,owner_id) on delete cascade,
 foreign key(project_id,owner_id) references public.projects(id,owner_id) on delete cascade
);
alter table private.ticket_agents enable row level security;
alter table private.ticket_agent_projects enable row level security;
revoke all on private.ticket_agents,private.ticket_agent_projects from public,anon,authenticated;

create function private.ticket_agent_owner() returns uuid language sql stable security definer set search_path='' as $$
 select a.owner_id from private.ticket_agents a where a.user_id=auth.uid() and a.enabled
 and not exists(select 1 from private.atelier_owners where user_id=auth.uid())
 and not exists(select 1 from private.workers where user_id=auth.uid());
$$;
create function private.require_ticket_agent(p_project uuid default null) returns uuid language plpgsql stable security definer set search_path='' as $$
declare owner uuid;
begin
 owner=private.ticket_agent_owner();
 if owner is null or (p_project is not null and not exists(select 1 from private.ticket_agent_projects where agent_id=auth.uid() and project_id=p_project and owner_id=owner)) then
  raise exception 'Compte agent ou projet non autorisé.' using errcode='42501';
 end if;
 return owner;
end; $$;

-- CAS versions also remain distinct when several calls share one SQL transaction.
create or replace function private.touch_record() returns trigger language plpgsql set search_path='' as $$
begin
 if new.owner_id<>old.owner_id then raise exception 'Le propriétaire ne peut pas être modifié.'; end if;
 new.created_at=old.created_at;
 new.updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 return new;
end; $$;

create table public.agent_ticket_claims (
 ticket_id uuid primary key references public.tickets on delete cascade,
 id uuid not null unique default gen_random_uuid(),
 owner_id uuid not null references auth.users on delete cascade,
 agent_id uuid not null references private.ticket_agents(user_id),
 agent_label text not null,
 state text not null check(state in ('running','review','approved','cancelled')),
 report jsonb,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.ticket_description_history (
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references public.tickets on delete cascade,
 owner_id uuid not null references auth.users on delete cascade,
 description text not null check(length(description)<=12000),
 agent_label text not null,
 previous_version timestamptz not null,
 replaced_version timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create index ticket_description_history_recent on public.ticket_description_history(ticket_id,created_at desc,id);
alter table public.agent_ticket_claims enable row level security;
alter table public.ticket_description_history enable row level security;
revoke all on public.agent_ticket_claims,public.ticket_description_history from public,anon,authenticated;
grant select on public.agent_ticket_claims,public.ticket_description_history to authenticated;
create policy human_claims_read on public.agent_ticket_claims for select to authenticated using(owner_id=auth.uid() and public.can_access_atelier());
create policy human_history_read on public.ticket_description_history for select to authenticated using(owner_id=auth.uid() and public.can_access_atelier());
create trigger notify_agent_claims after insert or update or delete on public.agent_ticket_claims for each row execute function private.atelier_change('workspace');

create table private.ticket_tool_receipts (
 actor_id uuid not null references auth.users on delete cascade,
 id uuid not null, fingerprint text not null, response jsonb not null,
 created_at timestamptz not null default clock_timestamp(), primary key(actor_id,id)
);
create index ticket_tool_receipts_recent on private.ticket_tool_receipts(actor_id,created_at desc);
alter table private.ticket_tool_receipts enable row level security;
revoke all on private.ticket_tool_receipts from public,anon,authenticated;

create function private.agent_claim_json(p_ticket uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'ticket_id',ticket_id,'agent_label',agent_label,'state',state,'report',report,'created_at',created_at,'updated_at',updated_at)
 from public.agent_ticket_claims where ticket_id=p_ticket;
$$;
create function private.agent_project_json(p_project uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(p)||jsonb_build_object('repository',(
  select jsonb_build_object('local_path',r.local_path,'label',r.label,'enabled',r.enabled)
  from public.project_repositories b join public.worker_repositories r on r.id=b.repository_id and r.owner_id=b.owner_id
  where b.project_id=p.id and b.owner_id=p.owner_id)) from public.projects p where p.id=p_project;
$$;
create function private.agent_description_history() returns trigger language plpgsql security definer set search_path='' as $$
declare label text;
begin
 if old.description is not distinct from new.description then return null; end if;
 select a.label into label from private.ticket_agents a where a.user_id=auth.uid() and a.owner_id=new.owner_id and a.enabled;
 if not found then return null; end if;
 insert into public.ticket_description_history(ticket_id,owner_id,description,agent_label,previous_version,replaced_version)
 values(new.id,new.owner_id,old.description,label,old.updated_at,new.updated_at);
 delete from public.ticket_description_history where ticket_id=new.id and id not in (
  select id from public.ticket_description_history where ticket_id=new.id order by created_at desc,id desc limit 20);
 return null;
end; $$;
create trigger preserve_agent_description after update of description on public.tickets for each row execute function private.agent_description_history();

-- Both execution surfaces serialize on the ticket. An agent cannot silently compete with Run.
create function private.guard_agent_development() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('queued','running','review') then
  perform 1 from public.tickets where id=new.ticket_id for update;
  if exists(select 1 from public.agent_ticket_claims where ticket_id=new.ticket_id and state in ('running','review')) then
   raise exception 'Un agent MCP traite déjà ce ticket. Validez ou annulez sa prise en charge.' using errcode='55000';
  end if;
 end if;
 return new;
end; $$;
create trigger guard_agent_development before insert or update of status on public.development_runs for each row execute function private.guard_agent_development();
create function private.guard_agent_done() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='done' and old.status<>'done' and exists(select 1 from public.agent_ticket_claims where ticket_id=new.id and state='running') then
  raise exception 'L’agent travaille encore. Attendez son rapport ou annulez la prise en charge.' using errcode='55000';
 end if;
 return new;
end; $$;
create trigger guard_agent_done before update on public.tickets for each row execute function private.guard_agent_done();
create function private.approve_manual_agent_done() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='done' and old.status<>'done' and new.owner_id=auth.uid() and public.can_access_atelier() then
  update public.agent_ticket_claims set state='approved',updated_at=clock_timestamp() where ticket_id=new.id and state='review';
 end if;
 return null;
end; $$;
create trigger approve_manual_agent_done after update on public.tickets for each row execute function private.approve_manual_agent_done();

create function public.agent_list_projects() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner uuid; rows jsonb;
begin
 owner=private.require_ticket_agent();
 select coalesce(jsonb_agg(private.agent_project_json(p.id) order by p.name,p.id),'[]') into rows
 from public.projects p join private.ticket_agent_projects s on s.project_id=p.id and s.owner_id=p.owner_id
 where s.agent_id=auth.uid() and s.owner_id=owner;
 return jsonb_build_object('projects',rows);
end; $$;
create function public.agent_list_tickets(p_project uuid,p_status text default null,p_limit integer default 50,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner uuid; rows jsonb; total bigint;
begin
 if p_project is null then raise exception 'Choisissez un projet.' using errcode='22023'; end if;
 owner=private.require_ticket_agent(p_project);
 if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 or (p_status is not null and p_status not in ('todo','in_progress','done')) then raise exception 'Pagination ou statut invalide.' using errcode='22023'; end if;
 select count(*) into total from public.tickets where project_id=p_project and owner_id=owner and (p_status is null or status=p_status);
 select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc,t.id),'[]') into rows from (
  select * from public.tickets where project_id=p_project and owner_id=owner and (p_status is null or status=p_status) order by updated_at desc,id limit p_limit offset p_offset) t;
 return jsonb_build_object('tickets',rows,'total',total);
end; $$;
create function public.agent_get_ticket(p_ticket uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner uuid; t public.tickets;
begin
 owner=private.require_ticket_agent();
 select * into t from public.tickets where id=p_ticket and owner_id=owner and project_id in (select project_id from private.ticket_agent_projects where agent_id=auth.uid() and owner_id=owner);
 if not found then raise exception 'Ticket inaccessible.' using errcode='42501'; end if;
 return jsonb_build_object('ticket',to_jsonb(t),'claim',private.agent_claim_json(t.id),'project',private.agent_project_json(t.project_id));
end; $$;
create function public.agent_search_tickets(p_query text,p_project uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner uuid; rows jsonb;
begin
 owner=private.require_ticket_agent(p_project);
 if p_query is null or length(btrim(p_query)) not between 1 and 500 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Recherche invalide.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc,t.id),'[]') into rows from (
  select * from public.tickets where owner_id=owner and (p_project is null or project_id=p_project)
  and project_id in (select project_id from private.ticket_agent_projects where agent_id=auth.uid() and owner_id=owner)
  and position(lower(btrim(p_query)) in lower(title||E'\n'||description))>0 order by updated_at desc,id limit p_limit) t;
 return jsonb_build_object('tickets',rows);
end; $$;

create function private.validate_agent_values(p_values jsonb,p_create boolean) returns void language plpgsql immutable set search_path='' as $$
declare k text;
begin
 if jsonb_typeof(p_values) is distinct from 'object' or p_values='{}'::jsonb or p_values-array['title','description','priority','difficulty','parent_id','prerequisite_ids']<>'{}'::jsonb then raise exception 'Champs du ticket invalides ; le statut ne peut pas être imposé par un agent.' using errcode='22023'; end if;
 if p_create and not p_values ? 'title' then raise exception 'Le titre est obligatoire.' using errcode='22023'; end if;
 foreach k in array array['title','description','priority','difficulty'] loop
  if p_values ? k and jsonb_typeof(p_values->k) is distinct from 'string' then raise exception 'Champ texte invalide.' using errcode='22023'; end if;
 end loop;
 if (p_values ? 'title' and length(btrim(p_values->>'title')) not between 1 and 160) or (p_values ? 'description' and length(p_values->>'description')>12000)
 or (p_values ? 'priority' and p_values->>'priority' not in ('low','medium','high','urgent')) or (p_values ? 'difficulty' and p_values->>'difficulty' not in ('easy','medium','hard','complex')) then raise exception 'Propriétés du ticket invalides.' using errcode='22023'; end if;
 if p_values ? 'parent_id' and jsonb_typeof(p_values->'parent_id') not in ('string','null') then raise exception 'Parent invalide.' using errcode='22023'; end if;
 if p_values ? 'prerequisite_ids' then
  if jsonb_typeof(p_values->'prerequisite_ids') is distinct from 'array' then raise exception 'Prérequis invalides.' using errcode='22023'; end if;
  if jsonb_array_length(p_values->'prerequisite_ids')>50 or exists(select 1 from jsonb_array_elements(p_values->'prerequisite_ids') x where jsonb_typeof(x)<>'string') then raise exception 'Prérequis invalides.' using errcode='22023'; end if;
 end if;
end; $$;
create function private.valid_agent_report(p_report jsonb) returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p_report) is distinct from 'object' or p_report-array['summary','tests','limitations']<>'{}'::jsonb or octet_length(p_report::text)>30000
 or jsonb_typeof(p_report->'summary') is distinct from 'string' or length(btrim(p_report->>'summary')) not between 1 and 8000
 or jsonb_typeof(p_report->'tests') is distinct from 'array' or jsonb_typeof(p_report->'limitations') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_report->'tests')>40 or jsonb_array_length(p_report->'limitations')>40
 or exists(select 1 from jsonb_array_elements((p_report->'tests')||(p_report->'limitations')) x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>2000) then return false; end if;
 return true;
end; $$;

-- Conservative attachment guard: preserving the complete Markdown token also
-- preserves its destination. Reference definitions are protected whenever the
-- old description contains an image; data URIs are protected independently.
create function private.preserve_agent_images(p_before text,p_after text) returns void language plpgsql immutable set search_path='' as $$
declare snippet text;
begin
 for snippet in select m[1] from regexp_matches(p_before,$re$(!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])?)$re$,'g') m
 union select m[1] from regexp_matches(p_before,$re$(data:image/[^\s)<>]+)$re$,'g') m
 union select m[1] from regexp_matches(p_before,$re$(?m)(^[ ]{0,3}\[[^\]]+\]:[^\n]*)$re$,'g') m where position('![' in p_before)>0
 loop
  if position(snippet in p_after)=0 then raise exception 'Une image ou sa référence serait supprimée. Conservez-la ou demandez une modification humaine.' using errcode='22023'; end if;
 end loop;
end; $$;

create function private.mutate_agent_ticket(p_action text,p_request uuid,p_ticket uuid,p_project uuid,p_version timestamptz,p_values jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid; t public.tickets; c public.agent_ticket_claims; result jsonb; prior private.ticket_tool_receipts; fingerprint text; values_ jsonb; label text;
begin
 owner=private.require_ticket_agent();
 if p_request is null then raise exception 'Identifiant de demande obligatoire.' using errcode='22023'; end if;
 perform 1 from private.atelier_owners where user_id=owner for update;
 if p_action='create' then
  if p_project is null then raise exception 'Projet obligatoire.' using errcode='22023'; end if;
  perform private.require_ticket_agent(p_project);
 else
  select * into t from public.tickets where id=p_ticket and owner_id=owner for update;
  if not found then raise exception 'Ticket inaccessible.' using errcode='42501'; end if;
  perform private.require_ticket_agent(t.project_id);
 end if;
 fingerprint=encode(sha256(convert_to(jsonb_build_object('action',p_action,'ticket',p_ticket,'project',p_project,'version',p_version,'values',p_values)::text,'UTF8')),'hex');
 select * into prior from private.ticket_tool_receipts where actor_id=auth.uid() and id=p_request;
 if found then
  if prior.fingerprint<>fingerprint then raise exception 'Identifiant déjà utilisé pour une autre demande.' using errcode='22023'; end if;
  return prior.response;
 end if;
 if (select count(*) from private.ticket_tool_receipts where actor_id=auth.uid() and created_at>now()-interval '1 hour')>=120 then raise exception 'Limite de 120 modifications agent par heure.' using errcode='55000'; end if;
 if p_action<>'create' then
  if p_version is null or t.updated_at is distinct from p_version then raise exception 'Le ticket a changé. Relisez-le avant de modifier.' using errcode='40001'; end if;
  if t.status='done' then raise exception 'Un agent ne peut pas modifier un ticket terminé.' using errcode='55000'; end if;
  if exists(select 1 from public.development_runs where ticket_id=t.id and status in ('queued','running','review')) then raise exception 'Une exécution Run est active ; attendez sa validation ou son annulation.' using errcode='55000'; end if;
  select * into c from public.agent_ticket_claims where ticket_id=t.id for update;
  if c.state in ('running','review') and (c.agent_id<>auth.uid() or c.state='review') then raise exception 'Ce ticket est réservé ou attend une validation humaine.' using errcode='55000'; end if;
 end if;
 if p_action='create' then
  perform private.validate_agent_values(p_values,true);
  insert into public.tickets(owner_id,project_id,title,description,priority,difficulty,parent_id,prerequisite_ids)
  values(owner,p_project,btrim(p_values->>'title'),coalesce(p_values->>'description',''),coalesce(p_values->>'priority','medium'),coalesce(p_values->>'difficulty','medium'),(p_values->>'parent_id')::uuid,
   array(select jsonb_array_elements_text(coalesce(p_values->'prerequisite_ids','[]'))::uuid)) returning * into t;
 elsif p_action in ('update','append','edit_body') then
  values_=p_values;
  if p_action='append' then
   if jsonb_typeof(p_values->'text') is distinct from 'string' or length(p_values->>'text') not between 1 and 12000 then raise exception 'Texte à ajouter invalide.' using errcode='22023'; end if;
   values_=jsonb_build_object('description',t.description||case when t.description='' then '' else E'\n\n' end||(p_values->>'text'));
  elsif p_action='edit_body' then values_=jsonb_build_object('description',p_values->'description'); end if;
  perform private.validate_agent_values(values_,false);
  values_=to_jsonb(t)||values_;
  perform private.preserve_agent_images(t.description,values_->>'description');
  update public.tickets set title=btrim(values_->>'title'),description=values_->>'description',priority=values_->>'priority',difficulty=values_->>'difficulty',
   parent_id=(values_->>'parent_id')::uuid,prerequisite_ids=array(select jsonb_array_elements_text(values_->'prerequisite_ids')::uuid)
  where id=t.id returning * into t;
 elsif p_action='claim' then
  if c.state in ('running','review') then raise exception 'Ce ticket est déjà pris en charge.' using errcode='55000'; end if;
  if exists(select 1 from public.tickets where id=any(t.prerequisite_ids) and status<>'done') then raise exception 'Terminez les prérequis avant de prendre ce ticket.' using errcode='55000'; end if;
  select a.label into label from private.ticket_agents a where a.user_id=auth.uid();
  update public.tickets set status='in_progress' where id=t.id returning * into t;
  insert into public.agent_ticket_claims(ticket_id,owner_id,agent_id,agent_label,state) values(t.id,owner,auth.uid(),label,'running')
  on conflict(ticket_id) do update set id=gen_random_uuid(),agent_id=excluded.agent_id,agent_label=excluded.agent_label,state='running',report=null,created_at=clock_timestamp(),updated_at=clock_timestamp();
 elsif p_action='review' then
  if c.state is distinct from 'running' or c.agent_id is distinct from auth.uid() or c.id is distinct from (p_values->>'claim')::uuid then raise exception 'Prise en charge invalide ou annulée.' using errcode='55000'; end if;
  if not private.valid_agent_report(p_values->'report') then raise exception 'Compte rendu invalide.' using errcode='22023'; end if;
  update public.tickets set status='in_progress' where id=t.id returning * into t;
  update public.agent_ticket_claims set state='review',report=p_values->'report',updated_at=clock_timestamp() where ticket_id=t.id;
 else raise exception 'Opération interdite.' using errcode='22023'; end if;
 result=jsonb_build_object('ticket',to_jsonb(t));
 if p_action in ('claim','review') then result=result||jsonb_build_object('claim',private.agent_claim_json(t.id)); end if;
 insert into private.ticket_tool_receipts(actor_id,id,fingerprint,response) values(auth.uid(),p_request,fingerprint,result);
 return result;
end; $$;

create function public.agent_create_ticket(p_request uuid,p_project uuid,p_values jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.mutate_agent_ticket('create',p_request,null,p_project,null,p_values); $$;
create function public.agent_update_ticket(p_request uuid,p_ticket uuid,p_version timestamptz,p_values jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.mutate_agent_ticket('update',p_request,p_ticket,null,p_version,p_values); $$;
create function public.agent_append_ticket(p_request uuid,p_ticket uuid,p_version timestamptz,p_text text) returns jsonb language sql security definer set search_path='' as $$ select private.mutate_agent_ticket('append',p_request,p_ticket,null,p_version,jsonb_build_object('text',p_text)); $$;
create function public.agent_edit_body(p_request uuid,p_ticket uuid,p_version timestamptz,p_description text) returns jsonb language sql security definer set search_path='' as $$ select private.mutate_agent_ticket('edit_body',p_request,p_ticket,null,p_version,jsonb_build_object('description',p_description)); $$;
create function public.agent_claim_ticket(p_request uuid,p_ticket uuid,p_version timestamptz) returns jsonb language sql security definer set search_path='' as $$ select private.mutate_agent_ticket('claim',p_request,p_ticket,null,p_version,'{}'); $$;
create function public.agent_finish_review(p_request uuid,p_ticket uuid,p_version timestamptz,p_claim uuid,p_report jsonb) returns jsonb language sql security definer set search_path='' as $$ select private.mutate_agent_ticket('review',p_request,p_ticket,null,p_version,jsonb_build_object('claim',p_claim,'report',p_report)); $$;

create function public.ticket_agent_activity(p_ticket uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare history jsonb;
begin
 if not public.can_access_atelier() then raise exception 'Accès humain avec double authentification requis.' using errcode='42501'; end if;
 if not exists(select 1 from public.tickets where id=p_ticket and owner_id=auth.uid()) then raise exception 'Ticket inaccessible.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'ticket_id',h.ticket_id,'description',h.description,'agent_label',h.agent_label,'previous_version',h.previous_version,'replaced_version',h.replaced_version,'created_at',h.created_at) order by h.created_at desc,h.id desc),'[]') into history
 from public.ticket_description_history h where h.ticket_id=p_ticket and h.owner_id=auth.uid();
 return jsonb_build_object('claim',private.agent_claim_json(p_ticket),'history',history);
end; $$;
create function private.human_agent_action(p_action text,p_request uuid,p_ticket uuid,p_reference uuid,p_version timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tickets; c public.agent_ticket_claims; old_text text; previous_text text; previous_version timestamptz; result jsonb; prior private.ticket_tool_receipts; fingerprint text;
begin
 if not public.can_access_atelier() then raise exception 'Accès humain avec double authentification requis.' using errcode='42501'; end if;
 if p_request is null then raise exception 'Identifiant de demande obligatoire.' using errcode='22023'; end if;
 perform 1 from private.atelier_owners where user_id=auth.uid() for update;
 select * into t from public.tickets where id=p_ticket and owner_id=auth.uid() for update;
 if not found then raise exception 'Ticket inaccessible.' using errcode='42501'; end if;
 fingerprint=encode(sha256(convert_to(jsonb_build_object('action',p_action,'ticket',p_ticket,'reference',p_reference,'version',p_version)::text,'UTF8')),'hex');
 select * into prior from private.ticket_tool_receipts where actor_id=auth.uid() and id=p_request;
 if found then
  if prior.fingerprint<>fingerprint then raise exception 'Identifiant déjà utilisé pour une autre demande.' using errcode='22023'; end if;
  return prior.response;
 end if;
 if p_version is null or t.updated_at is distinct from p_version then raise exception 'Le ticket a changé. Actualisez avant de confirmer.' using errcode='40001'; end if;
 select * into c from public.agent_ticket_claims where ticket_id=t.id for update;
 if p_action='restore' then
  if c.state='running' then raise exception 'Annulez la prise en charge avant de restaurer.' using errcode='55000'; end if;
  if exists(select 1 from public.development_runs where ticket_id=t.id and status in ('queued','running','review')) then raise exception 'Une exécution Run est active.' using errcode='55000'; end if;
  select description into old_text from public.ticket_description_history where id=p_reference and ticket_id=t.id and owner_id=auth.uid();
  if not found then raise exception 'Version historique inaccessible.' using errcode='42501'; end if;
  previous_text=t.description; previous_version=t.updated_at;
  update public.tickets set description=old_text where id=t.id returning * into t;
  if previous_text is distinct from old_text then
   insert into public.ticket_description_history(ticket_id,owner_id,description,agent_label,previous_version,replaced_version)
   values(t.id,t.owner_id,previous_text,'Restauration humaine',previous_version,t.updated_at);
   delete from public.ticket_description_history where ticket_id=t.id and id not in (
    select id from public.ticket_description_history where ticket_id=t.id order by created_at desc,id desc limit 20);
  end if;
 elsif p_action in ('approve','cancel') then
  if c.id is null or p_reference is null or c.id is distinct from p_reference or c.state not in ('running','review') then raise exception 'Prise en charge absente ou déjà clôturée.' using errcode='55000'; end if;
  if p_action='approve' then
   if c.state<>'review' then raise exception 'Attendez le compte rendu avant de valider.' using errcode='55000'; end if;
   if exists(select 1 from public.tickets where id=any(t.prerequisite_ids) and status<>'done') then raise exception 'Des prérequis restent ouverts.' using errcode='55000'; end if;
   update public.tickets set status='done' where id=t.id returning * into t;
  else
   update public.agent_ticket_claims set state='cancelled',updated_at=clock_timestamp() where ticket_id=t.id;
   update public.tickets set status=status where id=t.id returning * into t;
  end if;
 else raise exception 'Opération interdite.' using errcode='22023'; end if;
 result=jsonb_build_object('ticket',to_jsonb(t),'claim',private.agent_claim_json(t.id));
 insert into private.ticket_tool_receipts(actor_id,id,fingerprint,response) values(auth.uid(),p_request,fingerprint,result);
 return result;
end; $$;
create function public.restore_ticket_description(p_request uuid,p_ticket uuid,p_history uuid,p_version timestamptz) returns jsonb language sql security definer set search_path='' as $$ select private.human_agent_action('restore',p_request,p_ticket,p_history,p_version); $$;
create function public.approve_agent_review(p_request uuid,p_ticket uuid,p_claim uuid,p_version timestamptz) returns jsonb language sql security definer set search_path='' as $$ select private.human_agent_action('approve',p_request,p_ticket,p_claim,p_version); $$;
create function public.cancel_agent_claim(p_request uuid,p_ticket uuid,p_claim uuid,p_version timestamptz) returns jsonb language sql security definer set search_path='' as $$ select private.human_agent_action('cancel',p_request,p_ticket,p_claim,p_version); $$;

-- No helper is directly callable by browser/agent credentials.
revoke all on function private.ticket_agent_owner(),private.require_ticket_agent(uuid),private.agent_claim_json(uuid),private.agent_project_json(uuid),private.agent_description_history(),private.guard_agent_development(),private.guard_agent_done(),private.approve_manual_agent_done(),private.validate_agent_values(jsonb,boolean),private.valid_agent_report(jsonb),private.preserve_agent_images(text,text),private.mutate_agent_ticket(text,uuid,uuid,uuid,timestamptz,jsonb),private.human_agent_action(text,uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.agent_list_projects(),public.agent_list_tickets(uuid,text,integer,integer),public.agent_get_ticket(uuid),public.agent_search_tickets(text,uuid,integer),public.agent_create_ticket(uuid,uuid,jsonb),public.agent_update_ticket(uuid,uuid,timestamptz,jsonb),public.agent_append_ticket(uuid,uuid,timestamptz,text),public.agent_edit_body(uuid,uuid,timestamptz,text),public.agent_claim_ticket(uuid,uuid,timestamptz),public.agent_finish_review(uuid,uuid,timestamptz,uuid,jsonb),public.ticket_agent_activity(uuid),public.restore_ticket_description(uuid,uuid,uuid,timestamptz),public.approve_agent_review(uuid,uuid,uuid,timestamptz),public.cancel_agent_claim(uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.agent_list_projects(),public.agent_list_tickets(uuid,text,integer,integer),public.agent_get_ticket(uuid),public.agent_search_tickets(text,uuid,integer),public.agent_create_ticket(uuid,uuid,jsonb),public.agent_update_ticket(uuid,uuid,timestamptz,jsonb),public.agent_append_ticket(uuid,uuid,timestamptz,text),public.agent_edit_body(uuid,uuid,timestamptz,text),public.agent_claim_ticket(uuid,uuid,timestamptz),public.agent_finish_review(uuid,uuid,timestamptz,uuid,jsonb),public.ticket_agent_activity(uuid),public.restore_ticket_description(uuid,uuid,uuid,timestamptz),public.approve_agent_review(uuid,uuid,uuid,timestamptz),public.cancel_agent_claim(uuid,uuid,uuid,timestamptz) to authenticated;
create or replace function public.atelier_schema_version() returns integer language sql stable set search_path='' as $$ select case when public.can_access_atelier() then 9 else 0 end; $$;
commit;
