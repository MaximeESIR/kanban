begin;
-- Busy workers announce presence without claiming a second job after cancellation.
create function public.worker_heartbeat(p_capabilities text[]) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_capabilities is null or not p_capabilities <@ array['summarize','rewrite','transcribe','search']::text[] then
    raise exception 'Capacité interdite';
  end if;
  update private.workers set last_seen=now(),capabilities=p_capabilities where user_id=auth.uid() and enabled;
  if not found then raise exception 'Worker non autorisé' using errcode='42501'; end if;
end; $$;
revoke all on function public.worker_heartbeat(text[]) from public,anon;
grant execute on function public.worker_heartbeat(text[]) to authenticated;
create function public.atelier_schema_version() returns integer language sql stable set search_path='' as $$
  select case when public.can_access_atelier() then 4 else 0 end;
$$;
revoke all on function public.atelier_schema_version() from public,anon;
grant execute on function public.atelier_schema_version() to authenticated;
commit;
