# Maxime : ce que tu dois faire, dans l’ordre

**Ta connexion, la double authentification, le statut PC connecté et la recherche de notes fonctionnent. Le choix du modèle et de l’effort est activé. Pour saisir librement le chemin d’un projet et travailler directement dedans, passe à l’étape 8, déjà dépliée.**

**Déjà fait pour toi :** site GitHub Pages, application mobile installable, code, scripts, modèles de dictée/texte installés sur ce PC, service démarré et dépôt Atelier enregistré. **Tu n’as rien à réinstaller et aucun port de ta box à ouvrir.**

**Si une étape échoue : arrête-toi à cette étape et donne-moi son numéro et le message d’erreur. Ne m’envoie pas de mot de passe.**

<details>
<summary><strong>1 — DÉJÀ FAIT : créer le projet Supabase</strong></summary>

1. Ouvre [le tableau de bord Supabase](https://supabase.com/dashboard).
2. Crée ton compte ou connecte-toi. Le bouton de connexion avec GitHub peut servir si tu le souhaites.
3. Clique **New project**. Si une organisation est demandée, crée ton organisation personnelle et choisis la formule **Free** ([offre gratuite](https://supabase.com/pricing)).
4. Nomme le projet **atelier**. Choisis une région proche de toi, en Europe.
5. Génère le **Database password** et conserve-le dans ton gestionnaire de mots de passe. Ce mot de passe de base de données ne sera pas celui de connexion à Atelier.
6. Clique **Create new project**, puis attends que son tableau de bord soit prêt.

**C’est bon quand :** tu vois le projet `atelier` et son menu **SQL Editor**. Tu peux t’arrêter ici et me dire « étape 1 terminée » pour qu’on avance ensemble.

</details>

<details>
<summary><strong>2 — Installer les tables dans Supabase</strong></summary>

**Où tu travailles : dans ton navigateur, sur l’écran Supabase montré dans ta capture. Aucun terminal à ouvrir pour cette étape.**

**Fais le fichier 001 seulement pour commencer :**

1. Ouvre [le texte du fichier 001_atelier.sql](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/migrations/001_atelier.sql) dans un autre onglet. Ce lien ouvre directement le texte : aucun bouton « Raw » à chercher.
2. Sur cette page de texte, fais **Ctrl + A**, puis **Ctrl + C** : tout le fichier est copié.
3. Reviens dans l’onglet Supabase de ta capture.
4. Clique **dans la grande zone blanche au centre, juste à droite du chiffre 1**, puis fais **Ctrl + V**. Le texte du fichier doit apparaître dans cette zone.
5. Clique **Run**, le bouton **vert en haut à droite**, à côté de **Save**.
6. Lis le résultat **en bas, sous l’onglet Results**. Une réussite ressemble à **Success. No rows returned**. Envoie-moi ce message ou une capture avant qu’on continue.

**Si tu préfères ouvrir le fichier sur ton PC, son chemin exact est :**

```text
/home/mblaret/Documents/kanban/supabase/migrations/001_atelier.sql
```

Pour le retrouver dans l’explorateur de fichiers Ubuntu : ouvre **Fichiers**, appuie sur **Ctrl + L**, colle ce chemin et valide avec **Entrée**. Copie le contenu du fichier dans Supabase ; **ne colle pas le chemin à la place du contenu**.

**Les fichiers suivants, quand le précédent a réussi :**

| Ordre | Lien direct vers le texte à copier | Chemin complet sur ton PC |
| --- | --- | --- |
| 1 | [001_atelier.sql](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/migrations/001_atelier.sql) | `/home/mblaret/Documents/kanban/supabase/migrations/001_atelier.sql` |
| 2 | [002_connected_workspace.sql](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/migrations/002_connected_workspace.sql) | `/home/mblaret/Documents/kanban/supabase/migrations/002_connected_workspace.sql` |
| 3 | [003_ticket_relations.sql](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/migrations/003_ticket_relations.sql) | `/home/mblaret/Documents/kanban/supabase/migrations/003_ticket_relations.sql` |
| 4 | [004_worker_heartbeat.sql](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/migrations/004_worker_heartbeat.sql) | `/home/mblaret/Documents/kanban/supabase/migrations/004_worker_heartbeat.sql` |
| 5 | [005_ticket_execution.sql](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/migrations/005_ticket_execution.sql) | `/home/mblaret/Documents/kanban/supabase/migrations/005_ticket_execution.sql` |

Pour passer au suivant : copie le texte du fichier suivant, retourne dans Supabase, clique **dans le texte déjà collé**, fais **Ctrl + A** puis **Ctrl + V** pour le remplacer entièrement, puis **Run**. Tu n’as pas besoin de chercher un nouveau bouton ou d’enregistrer la requête avec Save.

Chaque fichier s’exécute **une seule fois**. S’il y a une erreur, arrête-toi et transmets-la ; ne relance pas tous les fichiers.

</details>

<details>
<summary><strong>3 — TOI : créer ton compte Atelier et le compte du PC</strong></summary>

Ces deux utilisateurs sont créés **à l’intérieur de ton projet Supabase**. Tu ne crées pas deux nouveaux comptes administrateurs Supabase.

**D’abord, ferme les inscriptions publiques.** Dans **Authentication → Sign In / Providers**, désactive **Allow new users to sign up** et **Allow anonymous sign-ins**, puis enregistre. Garde la connexion e-mail/mot de passe active. [Réglages officiels Supabase](https://supabase.com/docs/guides/auth/general-configuration).

**Crée ton utilisateur :**

1. Va dans **Authentication → Users → Add user → Create new user**.
2. Mets ton adresse e-mail et choisis ton mot de passe **pour Atelier**. Active **Auto Confirm User** si cette option apparaît, puis crée l’utilisateur.
3. Ouvre sa fiche et copie son **User UID / ID** : c’est le long identifiant avec des tirets, pas son e-mail.
4. Ouvre [le texte de authorize-owner.sql](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/authorize-owner.sql), copie son contenu dans une nouvelle requête SQL.
5. Remplace uniquement `REPLACE_WITH_YOUR_AUTH_USER_UUID` par cet identifiant, en conservant les apostrophes autour. Clique **Run**.

Fichier correspondant sur ton PC : `/home/mblaret/Documents/kanban/supabase/authorize-owner.sql`.

**Crée ensuite l’utilisateur PC :**

1. Reviens dans **Authentication → Users → Add user → Create new user**.
2. Utilise une autre adresse ou un alias que tu contrôles. Une adresse fictive comme `atelier-pc@example.com` convient aussi pour ce compte technique, avec **Auto Confirm User** activé ; elle ne recevra pas de mail de récupération. Choisis un mot de passe différent ; conserve ces deux valeurs pour l’étape 5. Confirme l’utilisateur comme précédemment.
3. Copie son **User UID / ID**.
4. Ouvre [le texte de authorize-worker.sql](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/authorize-worker.sql) et copie son contenu dans une nouvelle requête SQL.
5. Remplace `WORKER_AUTH_UUID` par l’identifiant du **PC**, puis `HUMAN_OWNER_AUTH_UUID` par **ton** identifiant. Conserve les apostrophes. Clique **Run**.

Fichier correspondant sur ton PC : `/home/mblaret/Documents/kanban/supabase/authorize-worker.sql`.

**C’est bon quand :** tu vois deux utilisateurs dans **Users**, et les deux requêtes d’autorisation ont réussi. Le compte PC doit figurer uniquement dans `authorize-worker`, jamais dans `authorize-owner`.

</details>

<details>
<summary><strong>4 — FAIT : relier GitHub au projet et ouvrir ton espace privé</strong></summary>

Si tu as créé des notes/tickets dans la démo, ouvre d’abord [Atelier](https://maximeesir.github.io/kanban/) et clique **Exporter mes données**. La démo n’est pas transférée automatiquement.

**Dans Supabase :**

1. Va dans **Authentication → URL Configuration**.
2. Mets **Site URL** à `https://maximeesir.github.io/kanban/`.
3. Ajoute dans **Redirect URLs** : `https://maximeesir.github.io/kanban/?recovery=1`. Enregistre.
4. Clique **Connect** dans ton projet. Dans la fenêtre **Connect to your project**, clique **Framework**, le premier rectangle en haut à gauche, avec l’icône cube et le texte **Use a client library**.
5. Tu peux laisser **Next.js** et **App Router** sélectionnés. Descends jusqu’à **Add files**, puis regarde l’onglet **`.env.local`** dans le cadre à droite. Aucune commande d’installation à exécuter ici.
6. Copie uniquement la valeur **après le signe `=`** sur chacune de ces deux lignes :

   | Ligne affichée dans Supabase | Valeur à garder |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL=…` | L’adresse complète `https://…supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=…` | La clé complète commençant par `sb_publishable_` |

   Le texte peut dépasser à droite : utilise la barre de défilement horizontale pour vérifier que tu as copié la valeur jusqu’au bout. Ne copie ni le nom avant `=`, ni le signe `=`. La ligne `postgresql://…` de l’onglet **Direct** n’est pas l’URL de l’application.
7. Garde ces deux valeurs pour GitHub et l’étape 5. La clé publique se retrouve aussi dans **Settings → API Keys**. [Documentation Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

**Dans GitHub :**

1. Ouvre [cette page de variables du dépôt](https://github.com/MaximeESIR/kanban/settings/variables/actions).
2. Dans l’onglet **Variables**, clique **New repository variable**, puis ajoute les deux lignes suivantes, une par une :

   | Name — copie exactement ce nom | Value — colle la valeur correspondante |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Le Project URL copié dans Supabase |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | La clé `sb_publishable_…` copiée dans Supabase |

   Clique **Add variable** pour enregistrer la première, puis **New repository variable** pour créer la seconde. Les noms dans GitHub commencent bien par **`VITE_`**, même si l’exemple Supabase affiche `NEXT_PUBLIC_`.

3. Ouvre [le workflow de publication](https://github.com/MaximeESIR/kanban/actions/workflows/deploy.yml).
4. Clique **Run workflow**, choisis la branche **main**, puis confirme **Run workflow**.
5. Attends que **verify**, **build** et **deploy** soient verts.

**Aucun fichier de code à modifier :** ces deux variables activent automatiquement la vraie connexion. GitHub Pages est déjà configuré.

**Dans Atelier :**

1. Ferme **tous les onglets Atelier**, ainsi que l’application Atelier installée si elle est ouverte. Rouvre ensuite [l’application](https://maximeesir.github.io/kanban/). Tu dois lire **BIENVENUE CHEZ VOUS**, sans le bloc **ACCÈS TEMPORAIRE**. Si ce bloc reste affiché, ouvre une fenêtre de navigation privée (**Ctrl + Maj + N** dans Chrome), puis ouvre le même lien pour vérifier sans l’ancienne version en cache. Ne réinitialise pas les données de la démo.
2. Connecte-toi avec **ton utilisateur de l’étape 3**, pas avec `k@k.k`. Utilise le mot de passe que tu as défini pour cet utilisateur dans Supabase ; il ne s’agit pas automatiquement du mot de passe de ta boîte Gmail.
3. Clique **Configurer la double authentification**. Scanne le QR code avec ton application d’authentification sur téléphone.
4. Saisis son **code à six chiffres**, puis clique **Vérifier**. Conserve une sauvegarde de cette application d’authentification.

**C’est bon quand :** tu vois tes projets après cette connexion. **Tu peux t’arrêter là pour utiliser le site privé** ; la partie PC vient ensuite. Si l’ancienne démo apparaît encore, ferme tous les onglets et la PWA Atelier, puis rouvre le site pour activer la mise à jour.

</details>

<details>
<summary><strong>5 — DÉJÀ FAIT : remplir le fichier privé du PC</strong></summary>

Sur **ton PC Ubuntu**, ouvre un terminal avec **Ctrl + Alt + T**, puis lance :

```bash
nano /home/mblaret/.config/atelier/worker.env
```

**Les quatre valeurs sont déjà renseignées et la connexion a été vérifiée.** Les instructions suivantes servent uniquement de référence pour une nouvelle installation. Ne colle pas le mot de passe dans la conversation.

Voici les quatre lignes concernées, pour les reconnaître dans le fichier :

| Ligne | Ce que tu dois y mettre |
| --- | --- |
| `ATELIER_SUPABASE_URL=` | Le même Project URL qu’à l’étape 4 |
| `ATELIER_PUBLISHABLE_KEY=` | La même clé `sb_publishable_…` qu’à l’étape 4 |
| `ATELIER_WORKER_EMAIL=` | L’e-mail de l’utilisateur **PC** créé à l’étape 3 |
| `ATELIER_WORKER_PASSWORD=` | Le mot de passe de cet utilisateur **PC** |

Ne mets ni ton compte personnel Atelier, ni le mot de passe de la base de données. Pour le mot de passe PC, une valeur aléatoire de 32 lettres/chiffres évite les caractères nécessitant un échappement dans ce fichier.

**Ne touche pas aux autres lignes : les modèles sont déjà configurés.**

Enregistre avec **Ctrl + O**, puis **Entrée** ; quitte avec **Ctrl + X**. Garde ce fichier sur ton PC, sans le copier dans GitHub ni dans la conversation.

**C’est bon quand :** les quatre valeurs sont remplies et le fichier est enregistré.

</details>

<details>
<summary><strong>6 — PC CONNECTÉ : essayer la dictée dans Atelier</strong></summary>

**Déjà fait :** profil Ubuntu installé, fichier privé rempli, diagnostic `doctor` réussi et service `atelier-worker` actif. Ton journal confirme son démarrage. Tu n’as aucune commande d’installation à refaire.

L’indication « PC non connecté » venait d’un décalage d’environ 2 min 50 entre l’horloge du PC et Supabase. Le code utilise désormais l’heure de Supabase pour cette vérification. Le programme du PC conserve ses protections et s’exécute avec ton compte habituel.

Après publication de la correction :

1. Ferme **tous les onglets Atelier**, ainsi que l’application Atelier si elle est installée et ouverte. Rouvre [Atelier](https://maximeesir.github.io/kanban/). Cela permet de charger la mise à jour sans effacer tes données.
   Si l’ancienne version reste affichée sur PC, utilise **Ctrl + Maj + R** : cette actualisation a résolu le problème sur ton navigateur.
2. Dans **Notes**, clique **Nouvelle note**, puis ouvre **Assistant PC**. Attends au plus 15 secondes : il doit afficher **connecté**.
3. Clique **Dicter**, autorise le microphone, prononce une phrase puis clique **Arrêter (90 s max)**. Le PC traite l’audio après cet arrêt ; le résultat doit apparaître sans recharger la page.
4. Pour les tickets : dans un projet, ouvre **Associer un dépôt sur le PC**. Sélectionne **Atelier** ; vérifie le chemin `/home/mblaret/Documents/kanban`. Le premier ticket Codex réel sera testé ensemble.

**Encore à vérifier avec toi :** la dictée depuis ton téléphone et un Run complet depuis le site (le modèle Codex a été testé réellement dans un dépôt séparé). Pour un autre dépôt, utilise la saisie du chemin décrite à l’étape 8.

</details>

<details>
<summary><strong>7 — DÉJÀ FAIT : choix du modèle et de l’effort Codex</strong></summary>

**Tu as déjà exécuté cette migration et redémarré le service. Vérification réussie : migration 006 active, service redémarré, huit modèles détectés.** Les instructions suivantes sont conservées comme référence ; ne rejoue pas cette migration.

**1. Dans Supabase :**

- Ouvre [le texte de la migration 006](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/migrations/006_codex_selection.sql). Clique dans le texte, fais **Ctrl + A**, puis **Ctrl + C**.
- Ouvre [SQL Editor de ton projet](https://supabase.com/dashboard/project/szutxqgfapqsmkixvvwy/sql/new).
- Clique dans la grande zone de saisie à droite, colle avec **Ctrl + V**, puis clique sur le bouton vert **Run**, en haut à droite.
- Le résultat attendu est **Success. No rows returned**. Ne relance pas les migrations 001 à 005.

Fichier identique sur ton PC : `/home/mblaret/Documents/kanban/supabase/migrations/006_codex_selection.sql`.

**2. Dans le terminal Ubuntu :** copie cette commande, appuie sur **Entrée**, puis saisis ton mot de passe Ubuntu s’il est demandé :

```bash
sudo systemctl restart atelier-worker.service
```

Ce redémarrage charge les scripts mis à jour. Le programme continue à tourner avec ton compte habituel. L’accès administrateur est nécessaire parce qu’Ubuntu gère cette unité comme un service système ; je ne dispose pas de ce mot de passe.

Ensuite, ouvre [Atelier](https://maximeesir.github.io/kanban/), fais **Ctrl + Maj + R** sur PC et attends 30 secondes. Dans ton projet, associe le dépôt local avec **Associer un dépôt sur le PC**. Clique **Run** sur un ticket enregistré : choisis **Modèle Codex**, puis **Effort de raisonnement**, et clique **Lancer le développement**.

Le premier modèle proposé actuellement est **GPT‑6.1 Sol**, effort **Faible (low)**. La liste provient du Codex installé sur le PC ; elle peut évoluer. Un refus d’accès au modèle ou un quota épuisé reste possible côté OpenAI. Ultra est exclu car il délègue à plusieurs agents, alors qu’Atelier conserve une seule session et un seul agent.

La création d’un ticket seule ne lance rien. Run passe le ticket en **In progress** à la prise en charge, développe directement dans le dépôt choisi, sur une branche gérée par Codex, puis fournit un rapport **À valider**. **Valider et passer à Done** ferme le ticket ; la fusion du code reste à faire sur le PC. Le choix du modèle et de l’effort est conservé dans le suivi.

**Vérifié :** un vrai Codex a corrigé une fonction Python et exécuté ses tests. Le dernier essai travaille directement dans le dépôt choisi, comme décrit à l’étape 8. **Encore à vérifier :** le parcours complet depuis ton Run sur le site.

</details>

<details open>
<summary><strong>8 — MAINTENANT : saisir le chemin de n’importe quel projet</strong></summary>

Cette mise à jour remplace la sélection limitée aux dépôts préenregistrés. **Le chemin que tu saisis sera le dossier de travail réel de Codex. L’application ne crée aucun clone, aucune copie ni aucun worktree.** Codex gère lui-même sa branche, ses commits et ses tests dans ce dépôt.

Deux actions pour activer la mise à jour, une seule fois :

1. Ouvre [le texte SQL 007](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/migrations/007_repository_paths.sql), copie tout son contenu, colle-le dans [SQL Editor de ton projet](https://supabase.com/dashboard/project/szutxqgfapqsmkixvvwy/sql/new), puis clique **Run** en haut à droite. Attends **Success. No rows returned**. Ne rejoue pas les migrations précédentes.
2. Dans ton terminal Ubuntu, lance :

```bash
bash /home/mblaret/Documents/kanban/worker/connect_pc.sh
```

Le script demande ton mot de passe Ubuntu pour remplacer l’unité système et la redémarrer. **Un simple restart ne suffit pas cette fois : les permissions du service doivent permettre l’ouverture des dossiers choisis.** Le programme reste exécuté avec ton compte, jamais root. Codex conserve un accès limité au dossier sélectionné ; secrets, configuration Git, récepteur Atelier et réseau de ses commandes restent protégés.

Ensuite :

1. Recharge [Atelier](https://maximeesir.github.io/kanban/) avec **Ctrl + Maj + R**.
2. Ouvre ton projet, puis **Associer un dépôt sur le PC**.
3. Dans **Indiquer un chemin sur le PC**, choisis **Dépôt Git existant** ou **Nouveau dossier pour le projet**.
4. Saisis le chemin complet, par exemple `/home/mblaret/Documents/chanson`, puis clique **Vérifier et associer** ou **Créer et associer**.
5. Attends **Chemin vérifié et associé au projet**. Tu peux ensuite lancer un ticket avec **Run**.

Le dossier parent d’un nouveau projet doit déjà exister. Aucun fichier existant n’est écrasé : un nouveau dossier doit être vide. Codex initialisera Git au premier Run. Le chemin vise toujours le PC, même si tu le saisis depuis ton téléphone. Si le PC est éteint, la demande attend son retour. L’association ne lance aucun développement.

**Vérifié réellement :** GPT‑6.1 Sol/low a corrigé une fonction, créé une branche et commité dans le dépôt de test d’origine, sans copie secondaire ; tests revérifiés séparément. La mise à jour de l’unité et le parcours complet depuis ton site restent à confirmer après ces deux actions.

</details>

---

**Mon travail après ton branchement :** vérifier la connexion réelle, la dictée depuis ton téléphone et un ticket Codex de test, puis corriger les problèmes constatés. Tu n’as pas à réécrire les scripts ou à comprendre leur architecture.


Les mesures et explications techniques sont dans [REFERENCE-PC.md](REFERENCE-PC.md). Elles ne font pas partie des étapes à suivre ici.
