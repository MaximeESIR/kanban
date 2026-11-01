# Maxime : ce que tu dois faire, dans l’ordre

**Ta capture montre que le projet `atelier` est créé et que SQL Editor est ouvert. Reprends à l’étape 2, déjà dépliée ci-dessous.** L’exécution du premier fichier n’est pas encore confirmée. Les autres étapes restent repliées.

**Déjà fait pour toi :** site GitHub Pages, application mobile installable, code, scripts, modèles de dictée/texte installés sur ce PC, service préparé et dépôt Atelier enregistré. **Tu n’as rien à réinstaller et aucun port de ta box à ouvrir.**

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

<details open>
<summary><strong>2 — MAINTENANT : copier le premier fichier dans Supabase</strong></summary>

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
2. Utilise une autre adresse ou un alias que tu contrôles. Choisis un mot de passe différent ; conserve ces deux valeurs pour l’étape 5. Confirme l’utilisateur comme précédemment.
3. Copie son **User UID / ID**.
4. Ouvre [le texte de authorize-worker.sql](https://raw.githubusercontent.com/MaximeESIR/kanban/main/supabase/authorize-worker.sql) et copie son contenu dans une nouvelle requête SQL.
5. Remplace `WORKER_AUTH_UUID` par l’identifiant du **PC**, puis `HUMAN_OWNER_AUTH_UUID` par **ton** identifiant. Conserve les apostrophes. Clique **Run**.

Fichier correspondant sur ton PC : `/home/mblaret/Documents/kanban/supabase/authorize-worker.sql`.

**C’est bon quand :** tu vois deux utilisateurs dans **Users**, et les deux requêtes d’autorisation ont réussi. Le compte PC doit figurer uniquement dans `authorize-worker`, jamais dans `authorize-owner`.

</details>

<details>
<summary><strong>4 — TOI : relier GitHub au projet et ouvrir ton espace privé</strong></summary>

Si tu as créé des notes/tickets dans la démo, ouvre d’abord [Atelier](https://maximeesir.github.io/kanban/) et clique **Exporter mes données**. La démo n’est pas transférée automatiquement.

**Dans Supabase :**

1. Va dans **Authentication → URL Configuration**.
2. Mets **Site URL** à `https://maximeesir.github.io/kanban/`.
3. Ajoute dans **Redirect URLs** : `https://maximeesir.github.io/kanban/?recovery=1`. Enregistre.
4. Clique **Connect** dans ton projet et copie **Project URL** et **Publishable key**. La clé à utiliser commence par `sb_publishable_`. Si nécessaire, retrouve-la dans **Settings → API Keys**. Garde ces deux valeurs pour GitHub et l’étape 5. [Où trouver ces valeurs](https://supabase.com/docs/guides/getting-started/api-keys).

**Dans GitHub :**

1. Ouvre [cette page de variables du dépôt](https://github.com/MaximeESIR/kanban/settings/variables/actions).
2. Dans l’onglet **Variables**, clique **New repository variable**, puis ajoute les deux lignes suivantes, une par une :

   | Name — copie exactement ce nom | Value — colle la valeur correspondante |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Le Project URL copié dans Supabase |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | La clé `sb_publishable_…` copiée dans Supabase |

3. Ouvre [le workflow de publication](https://github.com/MaximeESIR/kanban/actions/workflows/deploy.yml).
4. Clique **Run workflow**, choisis la branche **main**, puis confirme **Run workflow**.
5. Attends que **verify**, **build** et **deploy** soient verts.

**Aucun fichier de code à modifier :** ces deux variables activent automatiquement la vraie connexion. GitHub Pages est déjà configuré.

**Dans Atelier :**

1. Ouvre [l’application](https://maximeesir.github.io/kanban/) et connecte-toi avec **ton utilisateur de l’étape 3**, pas avec `k@k.k`.
2. Clique **Configurer la double authentification**. Scanne le QR code avec ton application d’authentification sur téléphone.
3. Saisis son **code à six chiffres**, puis clique **Vérifier**. Conserve une sauvegarde de cette application d’authentification.

**C’est bon quand :** tu vois tes projets après cette connexion. **Tu peux t’arrêter là pour utiliser le site privé** ; la partie PC vient ensuite. Si l’ancienne démo apparaît encore, ferme tous les onglets et la PWA Atelier, puis rouvre le site pour activer la mise à jour.

</details>

<details>
<summary><strong>5 — TOI : remplir le fichier privé du PC</strong></summary>

Sur **ton PC Ubuntu**, ouvre un terminal avec **Ctrl + Alt + T**, puis lance :

```bash
nano /home/mblaret/.config/atelier/worker.env
```

Ce fichier existe déjà. Remplis uniquement les quatre lignes suivantes avec les valeurs des étapes précédentes, après le signe `=` :

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
<summary><strong>6 — TOI : autoriser l’isolation Ubuntu, puis démarrer le PC</strong></summary>

**Cette étape demande ton mot de passe administrateur Ubuntu.** Il sert à autoriser le mécanisme de protection de Codex. Je n’ai pas pu réaliser cette action avec les droits disponibles.

Dans le terminal du PC, exécute ces commandes **une par une**. Quand `sudo` demande ton mot de passe, rien ne s’affiche pendant la saisie : c’est normal.

```bash
sudo apt install apparmor-profiles apparmor-utils
ls /usr/share/apparmor/extra-profiles/bwrap-userns-restrict
```

**Si `ls` dit que le fichier n’existe pas, arrête-toi et donne-moi ce message.** Sinon, continue :

```bash
sudo install -m 0644 /usr/share/apparmor/extra-profiles/bwrap-userns-restrict /etc/apparmor.d/bwrap-userns-restrict
sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
python3 /home/mblaret/Documents/kanban/worker/ticket_executor.py doctor
```

**Si le diagnostic dit « Isolation Codex indisponible », arrête-toi et transmets-moi ce message.** On ne désactive pas cette protection pour faire fonctionner Run. Cette correction ciblée est décrite dans la [documentation du sandbox Codex](https://learn.chatgpt.com/docs/sandboxing).

**Si le diagnostic dit « Isolation vérifiée », démarre le service :**

```bash
python3 /home/mblaret/Documents/kanban/worker/install_service.py
systemctl --user enable --now atelier-worker.service
systemctl --user status atelier-worker.service --no-pager
```

La dernière commande doit afficher **active (running)**. Attends quelques secondes, puis :

1. Dans Atelier, ouvre une note → **Assistant PC** : le PC doit apparaître connecté. Fais une courte dictée pour vérifier le retour du texte.
2. Dans un projet, ouvre **Associer un dépôt sur le PC**. Sélectionne **Atelier** ; vérifie le chemin `/home/mblaret/Documents/kanban`.
3. Si tu veux travailler dans un **autre dépôt**, donne-moi son chemin exact avant de lancer ses tickets : il faudra l’enregistrer sur le PC.
4. Le premier test réel de **Run** reste à vérifier ensemble sur un ticket de test précis. Ne lance pas un ticket quelconque uniquement pour essayer : Run autorise réellement Codex à modifier sa copie de travail.

**C’est bon quand :** le service tourne, le PC est connecté et une dictée revient dans l’application. La validation d’une vraie tâche Codex est la dernière vérification à faire ensemble.

</details>

---

**Mon travail après ton branchement :** vérifier la connexion réelle, la dictée depuis ton téléphone et un ticket Codex de test, puis corriger les problèmes constatés. Tu n’as pas à réécrire les scripts ou à comprendre leur architecture.


Les mesures et explications techniques sont dans [REFERENCE-PC.md](REFERENCE-PC.md). Elles ne font pas partie des étapes à suivre ici.
