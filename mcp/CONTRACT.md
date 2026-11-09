# Contrat SQL MCP — migration 009

La migration `009_ticket_agents.sql` s'applique après **001 à 007**. La migration
008 est réservée à une expérimentation facultative et n'est pas nécessaire.
Toutes les requêtes ci-dessous sont des appels POST `/rest/v1/rpc/NOM`, avec le
JWT d'un compte Supabase Auth **distinct du propriétaire et du worker PC**.
Le compte et ses projets sont autorisés par l'administrateur dans
`private.ticket_agents` et `private.ticket_agent_projects`. Aucun accès direct
aux tables, notes, secrets ou RPC du worker n'est accordé à cet agent.

## Objets retournés

Les objets `Ticket` sont les lignes JSON complètes de `public.tickets` :
`id`, `owner_id`, `project_id`, `number`, `title`, `description`, `status`,
`priority`, `difficulty`, `depends_on_id`, `parent_id`, `prerequisite_ids`,
`position`, `created_at`, `updated_at`. Les versions sont les **chaînes exactes** de
`updated_at` retournées par PostgreSQL ; ne pas les arrondir avec `Date`.

`Project` contient les colonnes du projet et un champ `repository`, nul en
l'absence d'association, sinon `{local_path: string, label: string,
enabled: boolean}`. Ce chemin est une métadonnée de l'association autorisée sur
le PC ; le serveur MCP n'exécute aucune commande et ne constitue pas une
isolation du système de fichiers du client Claude/Codex/Vibe.

`Claim` vaut `null` ou :

```json
{
  "id": "uuid",
  "ticket_id": "uuid",
  "agent_label": "Codex local",
  "state": "running",
  "report": null,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

`state` : `running | review | approved | cancelled`. `report` est nul ou
`{summary: string, tests: string[], limitations: string[]}`. Une nouvelle prise
en charge remplace la précédente prise en charge clôturée par un nouvel `id`.
Une prise en charge n'expire pas silencieusement : l'humain peut l'annuler.

## RPC agent

| Nom                    | Arguments JSON                                             | Résultat                                           |
| ---------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| `agent_list_projects`  | `{}`                                                       | `{projects: Project[]}`                            |
| `agent_list_tickets`   | `{p_project, p_status?: null, p_limit?: 50, p_offset?: 0}` | `{tickets: Ticket[], total: number}`               |
| `agent_get_ticket`     | `{p_ticket}`                                               | `{ticket: Ticket, claim: Claim, project: Project}` |
| `agent_search_tickets` | `{p_query, p_project?: null, p_limit?: 20}`                | `{tickets: Ticket[]}`                              |
| `agent_create_ticket`  | `{p_request, p_project, p_values}`                         | `{ticket: Ticket}`                                 |
| `agent_update_ticket`  | `{p_request, p_ticket, p_version, p_values}`               | `{ticket: Ticket}`                                 |
| `agent_append_ticket`  | `{p_request, p_ticket, p_version, p_text}`                 | `{ticket: Ticket}`                                 |
| `agent_edit_body`      | `{p_request, p_ticket, p_version, p_description}`          | `{ticket: Ticket}`                                 |
| `agent_claim_ticket`   | `{p_request, p_ticket, p_version}`                         | `{ticket: Ticket, claim: Claim}`                   |
| `agent_finish_review`  | `{p_request, p_ticket, p_version, p_claim, p_report}`      | `{ticket: Ticket, claim: Claim}`                   |

Identifiants UUID. `p_version` = version exacte du ticket précédemment lu.
`p_request` = UUID stable lors d'une nouvelle tentative de la **même opération**.
Une réutilisation avec d'autres arguments est refusée ; l'autorisation actuelle
est revérifiée avant un retour mis en cache. Une réponse rejouée est la réponse
historique de l'opération, pas une nouvelle lecture du ticket.

`p_values` accepte uniquement `title`, `description`, `priority`, `difficulty`,
`parent_id` (UUID ou null), `prerequisite_ids` (tableau UUID). Pour une création,
`title` est obligatoire ; description vide, priorité/difficulté `medium`, aucun
parent/prérequis par défaut. Le statut initial est toujours `todo`.
`update` est partiel ; aucun champ `status`, propriétaire ou projet n'est accepté.

Bornes : titre non vide 160 caractères, description 12000, texte ajouté
1..12000 (le résultat total reste <=12000), prérequis 50 distincts du même projet.
L'ajout insère deux sauts de ligne si l'ancienne description est non vide.
Priorité : `low | medium | high | urgent` ; difficulté :
`easy | medium | hard | complex`. Recherche littérale insensible à la casse,
requête non vide <=500 caractères, limite 1..50 ; liste limite 1..100,
offset 0..100000, statut nul ou `todo | in_progress | done`.
Rapport : résumé non vide <=8000 caractères, tableaux `tests` et `limitations`
obligatoires <=40 chaînes chacun, chaîne <=2000 caractères, JSON total <=30000
octets. Aucune clé supplémentaire dans le rapport. Au plus 120 modifications
agent par heure et par compte (les rejouages idempotents ne comptent pas).

Une prise en charge explicite vérifie les prérequis terminés puis passe le
ticket à `in_progress`. Elle exclut toute exécution Run active du même ticket.
Seul l'agent détenteur peut éditer pendant `running`. Le rapport passe la prise
en charge à `review` et laisse le ticket `in_progress`. Tout agent est bloqué
sur `done` ou `review`. Le MCP ne termine jamais un ticket et n'offre ni
approbation humaine, ni annulation, ni exécution de code.

## RPC navigateur humain (AAL2 uniquement)

| Nom                          | Arguments JSON                                | Résultat                             |
| ---------------------------- | --------------------------------------------- | ------------------------------------ |
| `ticket_agent_activity`      | `{p_ticket}`                                  | `{claim: Claim, history: History[]}` |
| `restore_ticket_description` | `{p_request, p_ticket, p_history, p_version}` | `{ticket: Ticket, claim: Claim}`     |
| `approve_agent_review`       | `{p_request, p_ticket, p_claim, p_version}`   | `{ticket: Ticket, claim: Claim}`     |
| `cancel_agent_claim`         | `{p_request, p_ticket, p_claim, p_version}`   | `{ticket: Ticket, claim: Claim}`     |

Les références d'images Markdown et les images intégrées sont conservées : une
modification agent qui retire ou change leur fragment Markdown est refusée.
Leur suppression volontaire reste une action humaine.

`History` : `{id, ticket_id, description, agent_label, created_at,
previous_version, replaced_version}`. `description` est l'ancien texte avant
modification par l'agent ou avant une restauration humaine (libellée
`Restauration humaine`, pour pouvoir l'annuler). Les vingt dernières versions sont conservées,
récentes en premier. La restauration exige la version actuelle exacte et est
bloquée pendant une prise en charge `running` ou une exécution Run active.
L'approbation exige `review` et passe le ticket à `done`. Le glisser-déposer
humain vers Done approuve aussi un rapport en attente, mais est interdit tant
que l'agent travaille. L'annulation ferme la prise en charge et conserve le
statut du ticket. Les modifications émettent l'événement `workspace` existant.

## Erreurs PostgreSQL

- `42501` : authentification, MFA ou périmètre insuffisant.
- `40001` : version périmée, relire et présenter le conflit ; ne pas écraser
  automatiquement avec une version plus récente.
- `22023` : arguments invalides ou UUID de demande réutilisé autrement.
- `55000` : prise en charge/exécution active, prérequis ouverts ou autre
  transition interdite.
- Les UUID, relations et contraintes SQL existantes peuvent également rendre
  `22P02`, `23503`, `23514` ou une erreur métier de dépendance.

Les messages sont affichables en français. Le navigateur et le serveur MCP
doivent conserver ces erreurs comme des échecs, sans annoncer de réussite.

## Migration 010 — activation de projets dans l’application

`all_projects=true` rend les projets actuels et futurs éligibles, sans les exposer
par défaut. `private.agent_workspace` contient les projets activés par le propriétaire.
`agent_workspace_state()` renvoie `{project_ids: UUID[], registered: boolean}` ;
`set_agent_project(p_project UUID, p_enabled boolean)` active ou retire un projet
avec MFA. Plusieurs projets peuvent être actifs. Retrait refusé si ce projet possède
un claim running/review. Verrou transactionnel partagé entre sélection et appels MCP.
Les comptes hérités en mode explicite gardent leur liste jusqu’au premier choix web.
Chaque session reçoit explicitement son projet/ticket ; l’autorisation des projets
est commune au compte MCP, pas une isolation entre les clients du même compte.
La désactivation ne révoque pas les informations déjà lues ni les droits locaux
sur les fichiers d’un client déjà lancé.
