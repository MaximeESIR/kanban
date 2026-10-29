-- AFTER creating your user in Supabase → Authentication → Users → Add user,
-- replace the UUID below with the user ID shown there, then run this query.
-- Keep this file as a template: do not commit your real account information.
insert into private.atelier_owners(user_id)
values ('REPLACE_WITH_YOUR_AUTH_USER_UUID')
on conflict do nothing;
