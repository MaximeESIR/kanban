-- Exécuter MANUELLEMENT dans le SQL Editor Supabase après 001–007 et 009.
-- Créer d'abord un utilisateur Auth distinct pour le MCP (email confirmé).
-- Ne jamais réutiliser le compte propriétaire ou le worker ; ne mettre aucun
-- mot de passe/clé dans ce fichier, Git, les tickets ou le navigateur.
-- Remplacer TOUS les UUID ci-dessous. Supprimer les lignes projet inutiles.
-- Trouver OWNER_AUTH_UUID et AGENT_AUTH_UUID : Authentication > Users > UID.
-- Trouver PROJECT_UUID : Table Editor > public.projects > colonne id, en
-- vérifiant owner_id et name (deux projets peuvent avoir le même nom).
-- On peut également exécuter cette lecture dans le SQL Editor :
-- select id, name, owner_id from public.projects order by name, id;
begin;
insert into private.ticket_agents(user_id, owner_id, label)
values ('AGENT_AUTH_UUID'::uuid, 'OWNER_AUTH_UUID'::uuid, 'Agent MCP local')
on conflict(user_id) do update set label=excluded.label, enabled=true;
insert into private.ticket_agent_projects(agent_id, owner_id, project_id)
values ('AGENT_AUTH_UUID'::uuid, 'OWNER_AUTH_UUID'::uuid, 'PROJECT_UUID'::uuid)
on conflict(agent_id,project_id) do nothing;
commit;

-- Désactiver immédiatement les futurs appels MCP (laisser les comptes-rendus).
-- update private.ticket_agents set enabled=false where user_id='AGENT_AUTH_UUID'::uuid;
-- Retirer un seul projet :
-- delete from private.ticket_agent_projects
-- where agent_id='AGENT_AUTH_UUID'::uuid and project_id='PROJECT_UUID'::uuid;
-- Annuler aussi une prise en charge depuis le navigateur humain si nécessaire.
-- Le compte Auth de l'agent est conservé pour l'historique ; privilégier sa
-- désactivation plutôt que sa suppression tant qu'une prise en charge existe.
