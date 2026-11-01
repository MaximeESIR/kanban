# Atelier — référence technique du PC

Pour les actions à réaliser, utilise [le guide pas à pas](CONNEXION-PC.md). Ce fichier conserve les mesures, les choix techniques et les limites de validation.

## État vérifié au 1er novembre 2026

| Partie | État réel |
| --- | --- |
| Site GitHub Pages / PWA installable sur téléphone | Version Supabase publiée ; écran personnel vérifié dans des navigateurs neufs sur ordinateur et mobile. |
| Compte privé, TOTP, synchronisation | Connexion personnelle et TOTP confirmés par le propriétaire ; synchronisation entre appareils encore à vérifier. |
| Dictée locale | faster-whisper small installé, transcription française réellement exécutée sur le PC. |
| Résumé, réécriture, recherche | Ollama + Qwen3.5 4B installés, trois inférences réelles réussies sur le PC. |
| Run, suivi et validation humaine | Interface, file SQL, scripts, agent et tests disponibles. Parcours navigateur testé sur serveur simulé ; worktree, processus et rapport testés avec exécuteur simulé. |
| Exécution réelle Codex | CLI connecté avec ChatGPT ; sandbox vérifié. Vraie correction Python par GPT‑6.1 Sol/low, tests exécutés par Codex puis revérifiés séparément, dépôt d’origine préservé. Parcours Run sur Supabase hébergé encore à vérifier après migration 006 et redémarrage du service. |
| Téléphone → Supabase hébergé → PC → téléphone | Compte PC, autorisation, heartbeat et abonnement Realtime vérifiés. Service système installé et actif, diagnostic d’isolation réussi au démarrage. Essai depuis le téléphone encore à faire. |

Le propriétaire confirme le statut PC connecté après **Ctrl + Maj + R**, puis une recherche de notes réussie via le moteur local. La dictée depuis son microphone reste à confirmer.

La publication connectée n’accepte plus les identifiants publics `k@k.k` / `k`. Les anciennes versions de démonstration restent **locales à chaque navigateur**. Ils ne protègent pas un compte privé et n’activent aucun traitement sur le PC. Pas de pourcentage artificiel de « fonctionnement global » : distinguer l’interface, les moteurs réellement testés et les parcours entre appareils encore à vérifier.

## 2. Modèles déjà installés sur ce PC

Installation sous le compte utilisateur, sans toucher aux autres modèles ni aux calculs GPU en cours :

| Composant | Configuration |
| --- | --- |
| Ollama | 0.40.13, archive officielle vérifiée par SHA-256 ; `~/.local/bin/ollama` |
| Service Ollama | `atelier-ollama.service`, activé au démarrage de la session utilisateur |
| Texte | `qwen3.5:4b`, 4,2 milliards de paramètres, Q4_K_M, environ 3,3 Go |
| Dictée | `Systran/faster-whisper-small`, révision `536b0662742c02347bc0e980a01041f333bce120`, environ 464 Mo |
| Python | `worker/.venv`, dépendances fixées dans `worker/requirements.txt` |
| Modèles | `~/.local/share/atelier/models/` |

Ollama écoute uniquement sur **127.0.0.1:11434**, `OLLAMA_NO_CLOUD=1`. CPU choisi pour préserver le GPU déjà occupé. Whisper utilise CPU/int8. Le worker charge uniquement les modèles déjà téléchargés ; une demande web ne déclenche aucun téléchargement.

Mesures ponctuelles, sur Intel i7-14700HX, sans prétendre garantir une latence :

| Essai réel | Résultat |
| --- | --- |
| Dictée française synthétique, 7,5 s d’audio | Chargement 0,66 s + transcription 2,84 s. Erreurs sur « Jetson » et « inférence ». |
| Même audio, vocabulaire technique personnalisé, via le worker | Environ 5,1 s processus/imports compris. « Jetson » correctement reconnu ; « inférence » reste mal reconnu. |
| Premier résumé de trois étapes Jetson | 20,06 s, chargement du modèle inclus ; contenu fidèle. |
| Réécriture, modèle chargé | 0,60 s ; correction d’une phrase. |
| Recherche Jetson parmi deux documents | 4,65 s ; bon identifiant retrouvé, sans sélectionner l’autre document. |

Ces essais ne remplacent pas un enregistrement réel de votre voix sur téléphone ni un benchmark de longues notes. `ATELIER_DICTATION_VOCABULARY` aide les termes techniques sans garantir leur reconnaissance. `ATELIER_THINK=false` est configuré pour Qwen3.5, contexte 8192 tokens. Une note très longue peut dépasser ce contexte : la réduire ou ajuster le contexte à la mémoire disponible. Le premier chargement est plus lent ; Ollama décharge le modèle après deux minutes d’inactivité.

Sur un autre PC Linux : Python 3.11+, `python3 -m venv worker/.venv`, `worker/.venv/bin/pip install -r worker/requirements.txt`, installer [Ollama](https://docs.ollama.com/linux), télécharger le modèle, puis télécharger un modèle compatible [faster-whisper](https://github.com/SYSTRAN/faster-whisper). PyAV est fixé à 16.1.0 : la version 19 testée était incompatible avec faster-whisper 1.2.1.

## 3. Corriger l’isolation Codex sur ce PC

Codex CLI 0.166.0 est déjà connecté avec le compte ChatGPT. **Codex local désigne son exécution dans le dépôt sur votre PC ; son modèle utilise les serveurs OpenAI et votre abonnement.** Ce n’est pas le modèle Ollama local. Aucune clé API IA n’est nécessaire, mais une connexion Internet et des droits d’utilisation Codex restent nécessaires.

Diagnostic :

```bash
python3 worker/ticket_executor.py doctor
```

Le contrôle réussit désormais sur ce PC. Les causes corrigées étaient les clés TOML mal encodées dans les options CLI, le PATH absent empêchant de trouver `/usr/bin/bwrap`, le binaire standalone installé dans le dossier privé `.codex`, et le refus de création de socket mal interprété par le test. Une copie identique du binaire, vérifiée par SHA-256 et accessible seulement à son propriétaire, est conservée sous `~/.local/share/atelier/executions/runtime/`. Le dossier `.codex` reste interdit aux commandes du modèle. Les tests de sandbox ne prouvent pas encore une tâche réelle avec le modèle Codex.

La [documentation officielle Ubuntu/Codex](https://learn.chatgpt.com/docs/sandboxing) propose un profil AppArmor ciblé. Cette installation a déjà été effectuée par le propriétaire sur ce PC ; commandes de référence pour une autre installation :

```bash
sudo apt install apparmor-profiles apparmor-utils
ls /usr/share/apparmor/extra-profiles/bwrap-userns-restrict
sudo install -m 0644 /usr/share/apparmor/extra-profiles/bwrap-userns-restrict /etc/apparmor.d/bwrap-userns-restrict
sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
python3 worker/ticket_executor.py doctor
```

Si le fichier n’est pas fourni ou le contrôle échoue encore, conserver Run désactivé et examiner le diagnostic. **Ne pas désactiver globalement AppArmor ou les restrictions système, ne pas passer Codex en accès intégral.** L’installation du service système décrite ci-dessous reste une action administrateur.

Le profil Codex limite les lectures et écritures, interdit les identifiants Atelier/Codex/SSH et le réseau des commandes, protège les métadonnées Git, désactive connecteurs, hooks et sous-agents. `--sandbox workspace-write` n’est pas ajouté : il écraserait les restrictions de lecture du profil nommé. Le contrôle exécute réellement une commande sans modèle et vérifie accès autorisé, refus d’accès privé, protection Git et réseau, à l’aide d’un témoin temporaire accessible seulement sur le loopback du PC. Sources : [permissions Codex](https://learn.chatgpt.com/docs/permissions), [mode non interactif](https://learn.chatgpt.com/docs/non-interactive-mode).

## 4. Un projet = un dépôt autorisé

Sur le PC, enregistrer explicitement **la racine Git** :

```bash
python3 worker/ticket_executor.py add /chemin/absolu/du/depot --label "Mon projet"
python3 worker/ticket_executor.py list
```

Le dépôt Atelier courant est déjà enregistré sur ce PC. Le registre privé est `~/.config/atelier/repositories.json` (permissions 600). Pour retirer un dépôt : `python3 worker/ticket_executor.py remove UUID_DU_DEPOT`. Le service actualise le registre toutes les 30 secondes.

Dans le projet sur téléphone ou ordinateur, ouvrir **Associer un dépôt sur le PC**, sélectionner le nom et **vérifier le chemin affiché**. Ce choix fixe le dépôt du projet. Plusieurs projets peuvent être associés à des dépôts différents ; tous utilisent la même file et **une seule session Codex à la fois**. Un nouveau chemin saisi uniquement dans un ticket n’accorde aucun droit au PC : il doit d’abord être enregistré localement.

Après ajout d’un dépôt, régénérer le service ci-dessous : systemd doit permettre au script Git d’écrire les métadonnées de ce dépôt. Les commandes Codex restent soumises à leur profil plus restrictif.

## 5. Configurer et démarrer le service

Sur ce PC, les identifiants privés sont renseignés et la connexion Supabase est vérifiée. Le service système est installé et actif depuis le 1er novembre 2026 à 14 h 21 (heure affichée par ce PC), après réussite du diagnostic d’isolation. Il remplace le service utilisateur : ses protections `ProtectHome`/`ProtectSystem` déclenchaient ici un namespace utilisateur avec le profil AppArmor `unprivileged_userns`, incompatible avec l’isolation imbriquée de Codex. L’unité système conserve les protections, avec `User=` et `Group=` fixés au compte habituel. Le processus Atelier ne tourne jamais comme root. Ollama fonctionne déjà. Les commandes ci-dessous servent de référence pour une nouvelle installation ou un changement de dépôts autorisés.

```bash
python3 worker/install_service.py --system
```

Ce script crée le fichier privé s’il n’existe pas et génère l’unité systemd à partir des chemins autorisés. Il ne remplace pas vos identifiants existants et ne lance pas un service non configuré.

Renseigner dans `~/.config/atelier/worker.env` :

- `ATELIER_SUPABASE_URL`
- `ATELIER_PUBLISHABLE_KEY` (publique, jamais administrateur)
- `ATELIER_WORKER_EMAIL` (compte PC séparé)
- `ATELIER_WORKER_PASSWORD`

Les chemins des modèles et leurs réglages sont déjà présents. Conserver `chmod 600 ~/.config/atelier/worker.env`. Les valeurs doivent respecter la syntaxe `EnvironmentFile` de systemd ; ne pas publier ce fichier.

Le script suivant installe uniquement l’unité Atelier avec sudo, désactive l’ancien service utilisateur et lance le service système. `ExecStartPre` impose le diagnostic réel avant chaque démarrage. `AF_NETLINK` est autorisé au service pour que bubblewrap prépare son interface réseau isolée ; le réseau des commandes Codex reste interdit par son propre sandbox. Référence : [systemd 255 — namespaces des services utilisateur](https://www.freedesktop.org/software/systemd/man/255/systemd.exec.html).

Après configuration et diagnostic :

```bash
bash /home/mblaret/Documents/kanban/worker/connect_pc.sh
systemctl status atelier-worker.service
sudo journalctl -u atelier-worker.service -n 50
```

Après correction du sandbox, redémarrer le service pour refaire son contrôle initial. Pour arrêter : `sudo systemctl stop atelier-worker.service`. Désactiver les démarrages futurs : `sudo systemctl disable atelier-worker.service` (et `atelier-ollama.service` si souhaité).

Le service vise **Linux** et utilise `fcntl`, les groupes de processus, le sandbox Codex et systemd. Aucun support Windows/macOS n’est revendiqué pour cet exécuteur. Le PC doit rester éveillé et connecté. Le service système reste disponible hors de la session graphique ; Ollama reste un service utilisateur, disponible pendant la session. Verrouiller l’écran n’arrête pas les traitements ; la mise en veille les interrompt.

## 6. Comment le PC reçoit les demandes

```mermaid
sequenceDiagram
  participant App as Téléphone / navigateur PC
  participant DB as Supabase
  participant PC as Service Python permanent
  participant Engine as Whisper / Ollama / Codex
  PC->>DB: Ouvrir un WebSocket sortant authentifié
  App->>DB: Demande explicite : dictée, résumé ou Run
  DB-->>PC: Notification sans contenu du ticket
  PC->>DB: Réclamer atomiquement une demande autorisée
  DB-->>PC: Contenu et bail de traitement
  PC->>Engine: Traiter localement
  Engine-->>PC: Résultat et vérifications
  PC->>DB: Publier résultat / compte rendu
  DB-->>App: Notification
  App->>DB: Récupérer le résultat autorisé
```

**Oui, un petit script tourne en continu. Non, il n’y a aucun port entrant Internet à ouvrir**, ni redirection sur la box. Le PC établit lui-même le WebSocket TLS vers Supabase et utilise HTTPS pour les RPC. Ollama dispose seulement d’un port local sur le PC. On ne lit pas la page HTML et aucun LLM ne tourne pour surveiller les tickets.

Les demandes et résultats sont persistants dans Supabase ; les notifications réveillent le service. Après abonnement et reconnexion, il rattrape la file. Après une fin de traitement, il vérifie s’il reste une demande. Les heartbeats annoncent la présence (environ 10 s), le navigateur vérifie cette présence toutes les 15 s, et la file hors ligne est entretenue toutes les 30 s. Ce ne sont pas des appels de modèle ni du scraping de page. L’application reçoit les changements sans reload ; un navigateur suspendu rattrape à la reprise.

La fraîcheur des heartbeats se calcule avec l’en-tête HTTPS `Date` de Supabase, exposé au navigateur par CORS, puis le temps monotone écoulé (`performance.now()`). Le statut PC et Run ne dépendent donc plus de l’horloge locale : un décalage d’environ 170 secondes avait produit un faux « non connecté » sur ce PC. Les autorisations et l’admission des demandes restent contrôlées côté SQL avec l’heure du serveur ; aucune règle de sécurité n’est assouplie.

### Dictée et notes

Dans une note ou un ticket, ouvrir **Assistant PC**, toucher **Dicter**, parler, puis arrêter. **L’audio est envoyé à l’arrêt**, pas mot à mot. Le résultat apparaît comme proposition ; insertion explicite et annulation disponibles. Réécriture et résumé passent par Ollama ; recherche sémantique légère sur les documents fournis. Sans PC, recherche textuelle et édition restent disponibles ; aucun fournisseur cloud ne prend le relais implicitement.

### Tickets Run

1. Enregistrer le ticket, vérifier ses prérequis et son dépôt, cliquer **Run**.
2. Le ticket reste en attente tant que la session précédente occupe le PC. Aucun changement de dépôt ou double démarrage silencieux.
3. À la prise en charge : **In progress**. Le service crée `atelier/UUID` et un worktree séparé depuis le **HEAD commité** du dépôt. Les modifications non commitées de votre copie habituelle ne sont pas incluses et restent intactes.
4. Le rôle `atelier-ticket` lit le code, planifie, réalise, teste et produit un compte rendu court. Les scripts transmettent l’état et le résultat ; Codex ne se connecte pas à Supabase ou GitHub pour gérer le ticket.
5. Le ticket reste **In progress — À valider**. Lire tests et limites, examiner le code local, puis **Valider et passer à Done** ou écarter le résultat. **Cette validation ne fusionne pas le code.** Aucun push/merge/déploiement automatique.

Les fichiers se trouvent sous `~/.local/share/atelier/executions/UUID/` : `worktree/`, `events.jsonl`, `receipt.json`, `report.json`, `delivery.json`. Journaux privés et modifications sont conservés après échec/annulation ; les nettoyer manuellement après revue, avec `git worktree remove` pour un worktree terminé et la suppression volontaire de sa branche si approprié. Les scripts ne suppriment pas automatiquement votre travail.

L’agent est défini dans `.codex/agents/atelier-ticket.toml`. Le service charge son rôle dans **la session unique** ; il ne lance pas une équipe. On peut aussi demander à Codex d’utiliser ce rôle lors d’une session manuelle dans le projet, mais la gestion de file/statut appartient au service.

### Choix du modèle et de l’effort

Run ouvre un sélecteur avant toute soumission. Le PC lit le catalogue de son CLI via `codex debug models` (cache de cinq minutes, aucune inférence), conserve uniquement les modèles visibles et leurs efforts pris en charge, puis publie ces métadonnées avec ses dépôts. Le navigateur ne transmet aucun argument de commande libre. La migration 006 valide le couple choisi et le fige dans `development_runs` ; le worker le revérifie avant de créer un worktree. Un modèle absent n’est jamais remplacé silencieusement. Les anciennes demandes sans choix sont refusées par le nouveau worker ; l’interface affiche le besoin de mise à jour si le catalogue manque.

Le lancement utilise explicitement `--model` et `-c model_reasoning_effort=…`, avec le fournisseur OpenAI. Le modèle travaille via le compte ChatGPT du PC, dans les limites de ce compte ; il ne s’agit pas du modèle Qwen local. Les commandes et fichiers restent sur le PC dans le sandbox existant. Les valeurs actuelles sont low, medium, high, xhigh et max selon le modèle. Ultra est exclu pour respecter l’absence de sous-agents. Sources : [modèles et efforts Codex](https://learn.chatgpt.com/docs/models), [configuration officielle](https://learn.chatgpt.com/docs/config-file/config-reference).

Les exécutables auxiliaires `codex-code-mode-host` et `codex-exec-server` de l’installation standalone sont désormais copiés et vérifiés par SHA-256 avec le CLI dans son cache privé. La première inférence réelle a révélé que copier le CLI seul suffisait au diagnostic de sandbox, mais pas à l’exécution des outils. Aucun répertoire d’identifiants n’a été rendu accessible pour corriger ce problème.

## Limites et garanties précises

- AAL2/TOTP pour les humains ; compte PC distinct, accès par RPC limité aux opérations et au propriétaire associés. Les chemins et commandes du navigateur ne deviennent pas des commandes shell.
- Run nécessite PC disponible et dépôt autorisé. Jusqu’à 20 exécutions en attente/en cours et 60 lancements/heure. Une seule active par ticket et une seule session Codex par PC. Annulation/retrait d’accès vérifiés pendant l’exécution ; bail expiré ou résultat tardif refusé. Pas de relance automatique d’une session incertaine.
- Une perte de contact prolongée arrête la session Codex ; la copie de travail reste disponible. Un processus peut avoir déjà écrit des fichiers avant l’annulation. L’arrêt vise tout son groupe de processus, y compris les tests lancés.
- Le dépôt autorisé et ses métadonnées Git sont lisibles : ne pas conserver de mots de passe dans `.git/config` ni dans l’historique. Les exclusions des fichiers personnels ne peuvent pas effacer un secret déjà commité.
- Le réseau des commandes Codex est fermé. Préparer les dépendances avant la tâche ou les tests peuvent rester bloqués. Le rapport doit le dire ; « À valider » ne signifie pas que toutes les vérifications ont réussi.
- Texte/audio : cinq demandes actives maximum, 60/heure ; audio 90 s et 4 Mo ; traitement limité à quatre minutes. Whisper est chargé dans un processus isolé par dictée. Une dictée peut fonctionner pendant une session Codex, au prix de ressources partagées.
- L’audio, les demandes et comptes rendus transitent par Supabase. TLS protège le transport ; **pas de chiffrement de bout en bout**. Les anciens résultats texte/audio sont purgés après sept jours lors de la consommation de la file ; les rapports de développement sont conservés avec le ticket.
- Recherche : 200 documents et 150 000 caractères JSON au maximum, contexte effectivement disponible dépendant du modèle. Pas d’index vectoriel persistant, pas de garantie contre les erreurs du modèle. Vérifier les sources proposées.
- Les données hors ligne et brouillons sont dans le navigateur sans chiffrement applicatif. Verrouiller/chiffrer les appareils ; la déconnexion efface les copies privées après synchronisation. Un administrateur ne peut pas effacer une copie déjà téléchargée sur un appareil distant.
- Tous les sites `MaximeESIR.github.io/...` partagent une origine navigateur : un autre site compromis sur cette origine pourrait lire les stockages. Pour isoler fortement Atelier, utiliser un sous-domaine dédié et l’ajouter dans Pages et Supabase Auth.
- Révocation du PC dans SQL : `update private.workers set enabled=false where user_id='UUID';`. Changer aussi le mot de passe s’il a été compromis.

## Vérification réelle après branchement

1. Mot de passe seul : données interdites ; après TOTP : accès. Compte PC : aucune lecture directe des notes/tickets.
2. Note modifiée sur téléphone → visible sur PC sans reload, puis inversement. Tester hors ligne/reconnexion et conflit entre appareils.
3. Arrêter le service → indisponibilité affichée ; redémarrer → disponibilité. Couper/reprendre le réseau et vérifier le rattrapage.
4. Dicter votre voix pendant 15 s, mesurer arrêt → résultat, vérifier les termes techniques. Tester réécriture, annulation et modification pendant traitement.
5. Sur un dépôt de test, Run un petit ticket avec tests connus : statut, branche, fichiers, compte rendu, aucun Done automatique. Valider explicitement.
6. Lancer deux tickets dans deux projets : constater une seule session Codex. Annuler l’un, vérifier arrêt et conservation du travail. Retirer le worker et vérifier refus des actions suivantes.
7. Vérifier que l’isolation refuse les fichiers personnels et le réseau, sans tenter de contourner le sandbox. Ne confier des dépôts sensibles qu’après ces vérifications réelles.
