-- Après 001–007,009,010. Remplacer les deux UUID, jamais de mot de passe.
insert into private.ticket_agents(user_id,owner_id,label,all_projects)
values ('AGENT_AUTH_UUID'::uuid,'OWNER_AUTH_UUID'::uuid,'Agent MCP local',true)
on conflict(user_id) do update set enabled=true,all_projects=true;
-- Ensuite sélectionner le projet dans l’application. Aucun projet accessible
-- avant sélection ; les projets futurs ne demandent pas de nouvelle requête.
-- Révocation :
-- update private.ticket_agents set enabled=false where user_id='AGENT_AUTH_UUID'::uuid;
