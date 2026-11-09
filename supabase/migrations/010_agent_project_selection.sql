begin;
alter table private.ticket_agents add column all_projects boolean not null default false;
create table private.agent_workspace (
 owner_id uuid not null references private.atelier_owners(user_id) on delete cascade,
 project_id uuid not null,
 primary key(owner_id,project_id),
 foreign key(project_id,owner_id) references public.projects(id,owner_id) on delete cascade
);
alter table private.agent_workspace enable row level security;
revoke all on private.agent_workspace from public,anon,authenticated;
create function private.agent_project_allowed(p_project uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.ticket_agents a where a.user_id=auth.uid() and a.enabled and (
 (a.all_projects and exists(select 1 from private.agent_workspace w where w.owner_id=a.owner_id and w.project_id=p_project))
 or (not a.all_projects and exists(select 1 from private.ticket_agent_projects s where s.agent_id=a.user_id and s.owner_id=a.owner_id and s.project_id=p_project))));
$$;
create or replace function private.require_ticket_agent(p_project uuid default null) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare owner uuid;
begin
 owner=private.ticket_agent_owner();
 if owner is null then raise exception 'Compte agent non autorisé.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,10));
 if p_project is not null and not private.agent_project_allowed(p_project) then
 raise exception 'Ce projet n’est pas sélectionné pour les agents dans l’application.' using errcode='42501'; end if;
 return owner;
end; $$;
create function public.agent_workspace_state() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.can_access_atelier() then raise exception 'Connexion avec MFA requise.' using errcode='42501'; end if;
 return jsonb_build_object('project_ids',(select coalesce(jsonb_agg(project_id),'[]'::jsonb) from private.agent_workspace where owner_id=auth.uid()),'registered',exists(select 1 from private.ticket_agents where owner_id=auth.uid() and enabled));
end; $$;
create function public.set_agent_project(p_project uuid,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.can_access_atelier() then raise exception 'Connexion avec MFA requise.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,10));
 if p_project is null or p_enabled is null or not exists(select 1 from public.projects where id=p_project and owner_id=auth.uid()) then raise exception 'Projet inaccessible.' using errcode='42501'; end if;
 if not p_enabled and exists(select 1 from public.agent_ticket_claims c join public.tickets t on t.id=c.ticket_id where c.owner_id=auth.uid() and t.project_id=p_project and c.state in ('running','review')) then raise exception 'Terminez, validez ou annulez la prise en charge en cours avant de changer de projet.' using errcode='55000'; end if;
 if not exists(select 1 from private.ticket_agents where owner_id=auth.uid() and enabled) then raise exception 'Enregistrez d’abord le compte MCP.' using errcode='55000'; end if;
 update private.ticket_agents set all_projects=true where owner_id=auth.uid();
 if p_enabled then
 insert into private.agent_workspace(owner_id,project_id) values(auth.uid(),p_project) on conflict do nothing;
 else delete from private.agent_workspace where owner_id=auth.uid() and project_id=p_project; end if;
 return public.agent_workspace_state();
end; $$;
create or replace function public.agent_list_projects() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare owner uuid; rows jsonb;
begin
 owner=private.require_ticket_agent();
 select coalesce(jsonb_agg(private.agent_project_json(p.id) order by p.name,p.id),'[]') into rows
 from public.projects p where p.owner_id=owner and private.agent_project_allowed(p.id);
 return jsonb_build_object('projects',rows);
end; $$;
create or replace function public.agent_get_ticket(p_ticket uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare owner uuid; t public.tickets;
begin
 owner=private.require_ticket_agent();
 select * into t from public.tickets where id=p_ticket and owner_id=owner and private.agent_project_allowed(project_id);
 if not found then raise exception 'Ticket inaccessible.' using errcode='42501'; end if;
 return jsonb_build_object('ticket',to_jsonb(t),'claim',private.agent_claim_json(t.id),'project',private.agent_project_json(t.project_id));
end; $$;
create or replace function public.agent_search_tickets(p_query text,p_project uuid default null,p_limit integer default 20) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare owner uuid; rows jsonb;
begin
 owner=private.require_ticket_agent(p_project);
 if p_query is null or length(btrim(p_query)) not between 1 and 500 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Recherche invalide.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc,t.id),'[]') into rows from (
  select * from public.tickets where owner_id=owner and (p_project is null or project_id=p_project)
  and private.agent_project_allowed(project_id)
  and position(lower(btrim(p_query)) in lower(title||E'\n'||description))>0 order by updated_at desc,id limit p_limit) t;
 return jsonb_build_object('tickets',rows);
end; $$;
alter function public.agent_list_tickets(uuid,text,integer,integer) volatile;
revoke all on function private.agent_project_allowed(uuid) from public,anon,authenticated;
revoke all on function public.agent_workspace_state(),public.set_agent_project(uuid,boolean) from public,anon;
grant execute on function public.agent_workspace_state(),public.set_agent_project(uuid,boolean) to authenticated;
create or replace function public.atelier_schema_version() returns integer language sql stable set search_path='' as $$ select case when public.can_access_atelier() then 10 else 0 end; $$;
commit;
