# Relier Claude Code, Codex et Vibe aux tickets Atelier

Les trois clients sont déjà configurés **sur ce PC** pour lancer le serveur MCP
Atelier. Le serveur et ses tests sont installés ; il reste à autoriser son compte
dans Supabase. Il n'y a aucune clé de modèle à ajouter pour le MCP : chaque
client conserve son modèle, son effort et son abonnement habituels.

Le MCP donne au client déjà ouvert des outils pour lire et modifier les tickets.
Le développement reste dans le dépôt que tu autorises, avec les outils du client.
Le bouton **Run** du site conserve son fonctionnement séparé avec le worker PC.

## À faire maintenant

### 1. Ajouter la mise à jour SQL 009

Les migrations **001 à 007** doivent déjà être appliquées. **008 n'est pas
nécessaire** : elle appartient à l'expérimentation Groq.

1. Dans VS Code, appuie sur **Ctrl+O**, colle ce chemin et appuie sur **Entrée** :
   `/home/mblaret/Documents/kanban/supabase/migrations/009_ticket_agents.sql`.
2. Dans ce fichier, fais **Ctrl+A**, puis **Ctrl+C** pour copier tout son contenu.
3. Ouvre [le SQL Editor de ton projet Supabase](https://supabase.com/dashboard/project/szutxqgfapqsmkixvvwy/sql/new).
4. Clique dans la grande zone de saisie, colle avec **Ctrl+V**, puis clique sur
   **Run**, en haut à droite.
5. Le résultat attendu est **Success. No rows returned**. Si une erreur apparaît,
   conserve son texte avant de continuer.

Fichier : [009_ticket_agents.sql](../supabase/migrations/009_ticket_agents.sql).

### 2. Créer le compte technique MCP

1. Ouvre [Authentication → Users dans ton projet](https://supabase.com/dashboard/project/szutxqgfapqsmkixvvwy/auth/users).
2. Clique sur **Add user**, puis **Create new user**.
3. Mets l'adresse `atelier-agent@example.com` et choisis un **nouveau mot de
   passe long**, à conserver dans ton gestionnaire de mots de passe.
4. Active **Auto Confirm User** si cette option est affichée, puis crée
   l'utilisateur. Il faut un compte confirmé ; aucune boîte mail n'est utilisée
   pour ce compte technique.
5. Ouvre cet utilisateur et copie son **User ID**. C'est une longue valeur avec
   des tirets. Tu vas la coller à l'étape 4.

Ce compte est différent de ton compte personnel et de `atelier-pc@example.com`.
Le même compte MCP peut servir à Claude Code, Codex et Vibe sur ce PC. Une prise
en charge déjà active empêche un deuxième appel de prise en charge du ticket,
même depuis un autre client utilisant ce compte. Le nom affiché dans les rapports
sera donc commun : **Agent MCP local**.

### 3. Autoriser le compte une seule fois

Après la migration009, exécute aussi `010_agent_project_selection.sql` depuis
`/home/mblaret/Documents/kanban/supabase/migrations/010_agent_project_selection.sql`
dans une nouvelle requête SQL. Copie tout le contenu du fichier, puis Run.

Dans une autre requête SQL, remplace uniquement `AGENT_AUTH_UUID` ci-dessous par
le User ID du compte technique. Aucun identifiant de projet n’est nécessaire :

```sql
insert into private.ticket_agents(user_id, owner_id, label, all_projects)
values ('AGENT_AUTH_UUID'::uuid,
        'cb849917-8c0e-4081-843f-109a8f9ede2f'::uuid,
        'Agent MCP local', true)
on conflict(user_id) do update set enabled=true, all_projects=true;
```

### 4. Sélectionner le projet dans l’application

Ouvre le projet souhaité dans Atelier, puis clique **Utiliser ce projet avec les agents**.
Ce choix est commun à Claude, Codex et Vibe. Plusieurs projets peuvent être activés simultanément. Seuls ces projets sont
accessibles, y compris pour la recherche. Désigne explicitement un projet et un ticket
à chaque session ; deux sessions peuvent traiter deux projets différents. Les futurs projets se sélectionnent avec le même bouton,
sans nouvelle commande SQL. **Retirer l’accès des agents** désélectionne le projet.
Termine, valide ou annule le travail en cours sur un projet avant de lui retirer l’accès.
Le changement n’efface pas les informations déjà lues : démarre une nouvelle session
du client pour séparer les contextes. La sélection ne lance aucun développement.

### 5. Enregistrer le mot de passe sur ton PC

Dans ton terminal, colle cette commande et appuie sur **Entrée** :

```bash
python3 /home/mblaret/Documents/kanban/mcp/setup.py
```

Le programme te demande, dans l'ordre :

1. **URL Supabase** : appuie simplement sur **Entrée**, ton projet est proposé.
2. **Clé publique** : colle la clé `sb_publishable_…` de ton projet, puis Entrée.
   Elle se trouve dans [Settings → API Keys](https://supabase.com/dashboard/project/szutxqgfapqsmkixvvwy/settings/api-keys),
   dans la rubrique des clés **Publishable**. N'utilise pas une clé `sb_secret_…`
   ou `service_role`.
3. **Adresse du compte agent** : appuie sur Entrée si tu as utilisé
   `atelier-agent@example.com`.
4. **Mot de passe** : colle ou saisis le mot de passe créé à l'étape 2, puis
   **Entrée**. Rien ne s'affiche pendant cette saisie : c'est normal.

Le résultat attendu est **Compte agent enregistré localement**. Aucun mot de
passe n'est à envoyer dans la conversation, dans un ticket, dans GitHub ou dans
la configuration des clients. Le fichier privé est
`~/.config/atelier/mcp.json`, lisible uniquement par ton utilisateur Linux.
Le script refuse d'écraser un fichier existant ; une correction volontaire
utilise la même commande avec `--replace` et conserve une sauvegarde privée.

### 6. Essayer depuis ton client habituel

Ouvre une **nouvelle session** Claude Code, Codex ou Vibe dans ton dépôt habituel.
Dans Claude Code, `/mcp` permet aussi de consulter la connexion **atelier**.
Demande d'abord :

> Utilise le MCP Atelier pour lister mes projets autorisés et les tickets du
> projet « NOM DU PROJET ». Ne commence aucun développement pour le moment.

Le serveur apparaît déjà dans les clients même avant l'étape 5 ; seules les
opérations sur les tickets demandent les identifiants. Une liste vide indique
qu'aucun projet n'est autorisé pour ce compte. Une erreur de migration demande
de vérifier l'étape 1.

Pour travailler ensuite, désigne un ticket précis et le dépôt autorisé :

> Traite uniquement le ticket « TITRE EXACT » du projet « NOM DU PROJET » avec
> Atelier. Le dépôt autorisé est /chemin/vers/mon/depot. Préserve mes changements
> en cours et gère une branche de travail si nécessaire. Prends le ticket en charge, développe, teste, puis
> rends un rapport pour ma validation. Ne le passe pas à Done.

Si plusieurs tickets portent le même nom, le client doit te faire préciser
lequel. Le chemin associé au projet est renvoyé par le MCP ; un chemin trouvé
dans le texte d'un ticket ne remplace pas ton autorisation. Aucun clone,
worktree ou dépôt secondaire n'est créé. Le client peut gérer une branche et
des commits dans le dépôt original, en respectant tes consignes.

Dans Atelier, ouvre ensuite le ticket : son rapport apparaît dans le suivi
des agents. **Valider le résultat de l'agent et passer à Done** est ton action
finale. Une annulation dans Atelier ferme la prise en charge mais n'interrompt
pas à distance le processus Claude/Codex/Vibe : arrête aussi le client concerné
avant de confier le travail à un autre.

## Fonctionnement et limites

Chaque client lance un petit serveur local **stdio** pendant sa session. Il
communique avec Supabase par HTTPS sortant lorsque tu utilises un outil. Aucun
port entrant, service permanent, modèle local supplémentaire ou interrogation
périodique n'est nécessaire pour ce MCP. Les notifications de l'application
web utilisent les événements Atelier existants.

Le compte MCP n'a accès qu'aux projets explicitement autorisés, à leurs tickets
et au chemin de dépôt associé. Les notes privées, les secrets et les fonctions
du worker ne sont pas exposés. Les textes des tickets restent des données à
vérifier : ils ne peuvent pas accorder des permissions supplémentaires au client.

| Outil                    | Action                                                      |
| ------------------------ | ----------------------------------------------------------- |
| `atelier_list_projects`  | Projets autorisés et dépôt associé                          |
| `atelier_list_tickets`   | Liste paginée d'un projet                                   |
| `atelier_get_ticket`     | Ticket, version exacte, prise en charge et projet           |
| `atelier_search_tickets` | Recherche textuelle dans les tickets autorisés              |
| `atelier_create_ticket`  | Nouveau ticket Todo, sans exécution                         |
| `atelier_update_ticket`  | Titre, description, priorité, difficulté, parent, prérequis |
| `atelier_append_ticket`  | Ajout au corps existant                                     |
| `atelier_edit_body`      | Remplacement explicite du corps avec contrôle de version    |
| `atelier_claim_ticket`   | Prise en charge explicite, passage In progress              |
| `atelier_finish_review`  | Rapport et attente de validation, toujours In progress      |

Chaque mutation demande un UUID de requête stable et, sauf la création, la
version exacte précédemment lue. Un conflit est refusé. Un nouvel appel avec
le même UUID et les mêmes arguments retrouve le résultat d'origine sans rejouer
l'écriture. Les descriptions remplacées sont historisées (20 versions), les
fragments d'images sont préservés, et seul l'humain peut valider Done. Le prompt
MCP `atelier_ticket_workflow` rappelle ce fonctionnement au client.

Les permissions du MCP protègent les données Supabase ; elles ne constituent
pas une isolation des fichiers pour un client disposant déjà d'un terminal.
Un programme lancé avec ton compte Linux peut lire les fichiers de ce compte.
Les protections habituelles de Claude/Codex/Vibe continuent donc à s'appliquer.
Le compte et le fichier MCP doivent rester privés sur un PC de confiance.

Le serveur local, le protocole SDK, les dix outils, l'authentification simulée,
les conflits et le parcours complet SQL ont été testés sans compte réel ni
appel à un modèle. **Le premier échange avec ton compte Supabase et le premier
ticket développé avec ton client restent à vérifier après les étapes ci-dessus.**

## Installation sur un autre PC et maintenance

Cette section n'est pas à refaire sur le PC où les trois clients ont déjà été
configurés. Prérequis : Node.js 20 ou plus récent, npm, Python 3.11 ou plus récent
et les clients désirés déjà installés. Dans le dépôt Atelier :

```bash
npm ci --prefix mcp
npm run check --prefix mcp
npm test --prefix mcp
npm run build --prefix mcp
python3 mcp/install_clients.py --dry-run
python3 mcp/install_clients.py
```

L'installateur ajoute l'entrée **atelier** aux clients présents, conserve une
sauvegarde privée des fichiers existants et ne remplace jamais une entrée
**atelier** différente. Une deuxième exécution conserve les entrées identiques.
L'option `--client codex`, `claude` ou `vibe` limite l'installation à un client.
Les sauvegardes sont dans `~/.config/atelier/client-backups/` ; leur contenu peut
contenir des secrets d'autres outils et n'est jamais affiché par le script.

Les fragments de configuration sans secrets sont dans
[configs/codex.toml](configs/codex.toml), [configs/claude.json](configs/claude.json)
et [configs/vibe.toml](configs/vibe.toml). Sur un autre PC, adapte le chemin du
launcher ; l'installateur le calcule automatiquement. Après une modification
du serveur TypeScript, reconstruis-le avec `npm run build --prefix mcp`, puis
reconnecte le MCP ou ouvre une nouvelle session du client.

Le SDK TypeScript officiel v2 est épinglé dans le lockfile ; son transport
stdio négocie le protocole avec les clients. Le contrat précis, les bornes et
les erreurs sont détaillés dans [CONTRACT.md](CONTRACT.md).

Sources officielles : [SDK MCP](https://modelcontextprotocol.io/docs/sdk),
[SDK TypeScript v2](https://ts.sdk.modelcontextprotocol.io/v2/),
[MCP dans Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[MCP dans Claude Code](https://code.claude.com/docs/en/mcp),
[MCP dans Mistral Vibe](https://docs.mistral.ai/vibe/code/cli/mcp-servers).


## Proxy réseau

Le transport utilise les variables `http_proxy`, `https_proxy`, `no_proxy` (ou leurs
équivalents majuscules) héritées du client. Si le client filtre ces variables, le serveur utilise en repli le fichier privé `~/.config/atelier/network.env` préparé par le script PC. Les valeurs explicites du client ont priorité. Ce fichier est lu comme données, jamais exécuté comme script ; propriétaire, permissions, taille et absence de liens symboliques sont vérifiés. Aucun contournement automatique du proxy,
aucune désactivation de TLS, aucune modification du VPN. Si Python/curl atteint
Supabase mais que le MCP échoue, vérifier le transport et l’environnement du client
avant d’attribuer le problème au VPN. Après une mise à jour du serveur, fermer et
rouvrir la session du client pour redémarrer son processus MCP.

Transport : [EnvHttpProxyAgent officiel](https://raw.githubusercontent.com/nodejs/undici/v6.29.1/docs/docs/api/EnvHttpProxyAgent.md), version épinglée.
