begin;

-- Each ticket is a single atomic offline write. A bounded UUID array avoids a partially
-- synchronized multi-row dependency update; the trigger enforces its foreign keys.
alter table public.tickets
  add column parent_id uuid,
  add column prerequisite_ids uuid[] not null default '{}',
  add constraint tickets_parent_fk foreign key(parent_id,project_id,owner_id)
    references public.tickets(id,project_id,owner_id) on delete set null(parent_id),
  add constraint tickets_parent_not_self check(parent_id is null or parent_id<>id),
  add constraint tickets_prerequisites_size check(cardinality(prerequisite_ids)<=50);
update public.tickets set prerequisite_ids=array[depends_on_id] where depends_on_id is not null;
create index tickets_parent_idx on public.tickets(parent_id) where parent_id is not null;
create index tickets_prerequisites_idx on public.tickets using gin(prerequisite_ids);

create or replace function private.check_ticket_dependency()
returns trigger language plpgsql set search_path='' as $$
declare n integer;
begin
  if TG_OP='UPDATE' and (new.project_id<>old.project_id or new.number<>old.number) then
    raise exception 'Le projet et le numéro du ticket ne peuvent pas être modifiés.';
  end if;
  -- Retain compatibility with a pre-migration client without allowing it to silently
  -- collapse several prerequisites into one.
  if TG_OP='INSERT' then
    if cardinality(new.prerequisite_ids)=0 and new.depends_on_id is not null then
      new.prerequisite_ids=array[new.depends_on_id];
    end if;
  elsif new.prerequisite_ids=old.prerequisite_ids and new.depends_on_id is distinct from old.depends_on_id then
    if cardinality(old.prerequisite_ids)>1 then raise exception 'Actualisez l’application pour modifier les prérequis multiples.'; end if;
    new.prerequisite_ids=case when new.depends_on_id is null then '{}'::uuid[] else array[new.depends_on_id] end;
  end if;
  if new.prerequisite_ids is null or cardinality(new.prerequisite_ids)>50
     or coalesce(array_ndims(new.prerequisite_ids),1)<>1 or coalesce(array_lower(new.prerequisite_ids,1),1)<>1
     or array_position(new.prerequisite_ids,null) is not null
     or cardinality(new.prerequisite_ids)<>(select count(distinct x) from unnest(new.prerequisite_ids) x) then
    raise exception 'Choisissez au maximum 50 prérequis distincts.';
  end if;
  new.depends_on_id=new.prerequisite_ids[1];
  -- Serialize relationship changes within a project, including offline clients.
  perform 1 from public.projects where id=new.project_id and owner_id=new.owner_id for update;
  if not found then return new; end if; -- project FK enforces inserts; allow cascade cleanup
  select count(*) into n from public.tickets where id=any(new.prerequisite_ids)
    and project_id=new.project_id and owner_id=new.owner_id;
  if n<>cardinality(new.prerequisite_ids) then raise exception 'Les prérequis doivent appartenir au même projet et propriétaire.'; end if;
  if new.id=any(new.prerequisite_ids) or exists(
    with recursive chain(id) as (
      select unnest(new.prerequisite_ids)
      union
      select unnest(t.prerequisite_ids) from public.tickets t join chain c on t.id=c.id
        where t.project_id=new.project_id and t.owner_id=new.owner_id
    ) select 1 from chain where id=new.id
  ) then raise exception 'Cette dépendance créerait une boucle entre les tickets.'; end if;
  if new.parent_id=new.id or exists(
    with recursive parents(id) as (
      select new.parent_id where new.parent_id is not null
      union
      select t.parent_id from public.tickets t join parents p on t.id=p.id
        where t.parent_id is not null and t.project_id=new.project_id and t.owner_id=new.owner_id
    ) select 1 from parents where id=new.id
  ) then raise exception 'Cette hiérarchie créerait une boucle entre les tickets.'; end if;
  return new;
end; $$;

create function private.unlink_deleted_ticket() returns trigger language plpgsql set search_path='' as $$
begin
  perform 1 from public.projects where id=old.project_id and owner_id=old.owner_id for update;
  if found then
    update public.tickets set
      prerequisite_ids=array_remove(prerequisite_ids,old.id),
      depends_on_id=(array_remove(prerequisite_ids,old.id))[1],
      parent_id=case when parent_id=old.id then null else parent_id end
    where id<>old.id and project_id=old.project_id and owner_id=old.owner_id
      and (old.id=any(prerequisite_ids) or parent_id=old.id);
  end if;
  return old;
end; $$;
revoke all on function private.unlink_deleted_ticket() from public,anon,authenticated;
create trigger tickets_unlink before delete on public.tickets for each row execute function private.unlink_deleted_ticket();

-- Extend the existing version-checked write; no extra table or client permission.
create or replace function public.sync_write(p_request uuid,p_table text,p_id uuid,p_base timestamptz,p_delete boolean,p_values jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare old jsonb; response jsonb; cols text; assignments text; allowed text[];
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
   if p_table='tickets' then p_values=jsonb_build_object('position',0,'parent_id',null,'prerequisite_ids','[]'::jsonb)||p_values; end if;
   allowed=case p_table when 'notes' then array['title','content','category'] when 'projects' then array['name','description','color'] else array['project_id','title','description','status','priority','difficulty','depends_on_id','position','parent_id','prerequisite_ids'] end;
   select string_agg(format('%I',x),','),string_agg(format('%I=v.%I',x,x),',') into cols,assignments from unnest(allowed) x;
   if old is null then
     execute format('insert into public.%I (id,owner_id,%s) select $1,$2,%s from jsonb_populate_record(null::public.%I,$3) v returning to_jsonb(%I.*)',p_table,cols,cols,p_table,p_table) into response using p_id,auth.uid(),p_values;
   else
     execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$3) v where t.id=$1 and t.owner_id=$2 returning to_jsonb(t.*)',p_table,assignments,p_table) into response using p_id,auth.uid(),p_values;
   end if;
   response=jsonb_build_object('row',jsonb_build_object('id',p_id,'owner_id',auth.uid(),'updated_at',response->'updated_at') || case when p_table='tickets' then jsonb_build_object('number',response->'number','parent_id',response->'parent_id','prerequisite_ids',response->'prerequisite_ids','depends_on_id',response->'depends_on_id') else '{}'::jsonb end);
 end if;
 insert into private.sync_receipts values(auth.uid(),p_request,response);
 return response;
end; $$;
commit;
