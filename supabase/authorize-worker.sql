-- Create a SECOND email/password user in Supabase Auth for the PC.
-- NEVER add that user to atelier_owners. Replace both UUID placeholders below.
insert into private.workers(user_id,owner_id,label)
values ('WORKER_AUTH_UUID','HUMAN_OWNER_AUTH_UUID','Mon PC');
-- Revoke immediately: update private.workers set enabled=false where user_id='WORKER_AUTH_UUID';
