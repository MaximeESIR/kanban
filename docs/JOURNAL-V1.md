# Journal de réalisation — V1.0

## 31 octobre 2026

- Référence étudiée : `flyingpafnouti/kan`, commit `563ea3864e1fb0dd0ffcb80f1cf4337633af1fe2`. Lecture du code uniquement, sans exécuter le projet ni utiliser ses comptes ou ses clés.
- Choix utilisateur : aucun abonnement ni clé d’API IA. Traitements sur PC uniquement ; les adaptateurs de développement Codex/Vibe restent une extension future, sans exécution de commandes arbitraires dans cette version.
- Branche de travail : `feature/connected-workspace`.
- Ajout de Markdown, KaTeX et Mermaid en mode strict, HTML filtré, images PNG/JPEG/WebP recompressées avant incorporation dans les notes. Images distantes non chargées pour éviter le suivi involontaire.
- PWA installable avec icônes et cache des fichiers statiques ; aucun appel Auth, audio ou résultat privé dans le cache du service worker. Une mise à jour attend la fermeture des onglets pour ne pas interrompre la saisie.
- Incident : l’outil initial de génération PWA ajoutait plusieurs dépendances signalées vulnérables. Remplacé par un petit générateur de cache statique dans le dépôt. Mise à jour de la dépendance KaTeX imbriquée de Mermaid, puis contrôle de l’audit npm.
- Incident détecté par les tests de production : les en-têtes `Vary` du serveur de prévisualisation empêchaient de retrouver les scripts en cache hors ligne. Correspondance corrigée uniquement pour les fichiers statiques immuables ; aucune réponse privée concernée.
- Ergonomie ajoutée : Pro/Perso, vue globale, thème sombre, archives Done, export Markdown, appui long sur poignée et tri par boutons, raccourcis /, n et Échap.
- Incident navigateur : les outils enrichis dépassaient le panneau de note de hauteur fixe. Passage à une hauteur adaptative, puis validation du scénario de réécriture.
- Contrôle du site publié : connexion, projet, ticket, déplacement et rechargement hors ligne réussis sur les deux formats d’écran. Une fausse notification de mise à jour à la toute première installation a été repérée, corrigée et ajoutée au test PWA.
- Synchronisation par IndexedDB + file persistante. Verrou entre onglets, identifiants de requête uniques, reçus côté PostgreSQL, comparaison de version avant modification. Les conflits préservent la version distante et archivent la version locale dans la sauvegarde complète.
- Double authentification TOTP pour tous les comptes humains, à l’entrée de l’interface ET dans les règles RLS. Le compte du PC est distinct et n’a aucun accès direct aux tables de notes/projets.
- File PC : demandes bornées, quotas, présence récente et capacités requises à l’envoi, prise atomique, bail de traitement, résultats tardifs ou annulés rejetés. Audio/texte de la demande supprimés après traitement ; résultats conservés sept jours puis purgés lors des passages du worker.
- Service Python à connexions sortantes uniquement. Ollama local pour texte/recherche ; faster-whisper avec modèle déjà téléchargé pour l’audio. Aucun shell ni téléchargement de modèle déclenché par un ticket.
- Réécriture : proposition explicite, original conservé, annulation, remplacement désactivé si le texte a changé pendant le traitement. La recherche filtre les identifiants inventés par le modèle.

## Vérifications et limites

Les commandes de validation sont dans le README. Les tests couvrent la base réelle via PGlite, le transport hors ligne via IndexedDB simulé, les parcours navigateur desktop/mobile, l’installation du cache et la réouverture sans réseau, et les opérations du worker avec moteurs simulés.

Dernière validation locale : **48 tests réussis** (26 tests Vitest, 6 tests Python, 12 parcours navigateur, 2 parcours assistant avec serveur simulé, 2 parcours PWA sur le build de production). Vérification TypeScript et build réussis ; `npm audit --omit=dev` ne signale aucune vulnérabilité connue à cette date. Le workflow GitHub répète ces validations avant publication. Ces résultats ne constituent pas un audit de sécurité indépendant.

Sans projet Supabase et sans moteur installé/configuré sur le PC, nous ne pouvons pas valider une session TOTP réelle, un échange avec Supabase hébergé, la qualité du modèle local, une transcription réelle ni la synchronisation entre deux appareils physiques. Ces vérifications restent obligatoires avant d’y confier des données importantes. La démo publique ne lance aucun traitement PC.

## 1er novembre 2026 — V1.1

- Étude des trois commits de la référence depuis `563ea386`, jusqu’à `c5c77f9` : sauvegarde à la fermeture, tri global priorité/récence, tickets parents et bloqueurs.
- Séparation du parent de regroupement et des prérequis multiples. Migration des dépendances existantes ; limite de 50 prérequis, vérification serveur du projet/propriétaire et des cycles. Les liens sont enregistrés atomiquement avec le ticket pour rester compatibles avec la file hors ligne. Suppression : retrait du lien, conservation des autres prérequis et des sous-tickets.
- Vue imbriquée dans les colonnes, compteurs de progression, liens de navigation, ajout d’un sous-ticket, indication Bloqué/Prêt et notification de déblocage. Tri global mémorisé.
- Brouillon local à chaque saisie, sauvegarde à la fermeture et en arrière-plan, reprise après interruption. Chaque édition a son propre identifiant de brouillon. Une version obsolète ne remplace pas un ticket modifié ailleurs ; copie du brouillon possible. Export des brouillons et effacement à la déconnexion.
- Service PC : vérification des demandes toutes les 2 secondes au lieu de 10, capacités mises en cache 30 secondes, lecture des résultats du processus toutes les 250 ms. Nouveau heartbeat pendant le calcul pour éviter de réclamer et perdre une deuxième demande après annulation de la première. Une livraison échouée est retentée avec le même résultat ; un moteur interrompu clôt le traitement au lieu de bloquer la boucle.
- Ajout d’une vérification de version du schéma pour refuser une ancienne base plutôt que perdre silencieusement les nouveaux champs.
- Cas de reprise hors ligne traité : si un prérequis a été supprimé ailleurs, l’écriture refusée est conservée dans les conflits et les modifications indépendantes suivantes peuvent se synchroniser. Les erreurs de réseau ou d’autorisation gardent la file en attente pour réessai.
- Validation ajoutée : graphes avec prérequis partagés, hiérarchie/cycles, isolation SQL, migration, suppression en cascade, reprise IndexedDB, tri et restauration de brouillons sur desktop/mobile, concurrence, dictée avec microphone et moteur simulés, annulation et reprise du worker.
- Limites inchangées : aucune connexion Supabase réelle ni inférence sur matériel utilisateur n’a encore été testée. La dictée est envoyée après arrêt du microphone ; pas de transcription en continu. Le modèle Whisper est rechargé par traitement : mesurer avant de décider d’un moteur persistant. Pas d’agent de développement ni d’orchestration d’équipes.
- Guide de mise en service enrichi : état fonctionnel par composant, quatre migrations, réglages GitHub/Supabase, service PC, trajet d’une dictée et mesure de la latence.
- Validation locale V1.1 : **73 tests réussis** (37 Vitest, 10 Python, 20 parcours navigateur, 4 parcours assistant avec moteur simulé, 2 parcours PWA de production). TypeScript et build réussis. Contrôle automatique d’accessibilité et captures du formulaire de relations sur les deux formats d’écran.

## 1er novembre 2026 — V1.2, modèles locaux et tickets exécutables

- Demande précisée : un projet correspond à un dépôt explicitement enregistré, sélectionnable depuis PC ou mobile. Une seule session Codex pour tous les projets ; les scripts gèrent réception et suivi. Done reste une décision humaine.
- Modèles installés dans le compte utilisateur : Ollama 0.40.13 (SHA-256 de l’archive vérifié), Qwen3.5 4B Q4_K_M, faster-whisper small révision `536b0662742c02347bc0e980a01041f333bce120`. Le GPU étant déjà occupé, service configuré en CPU, lié uniquement à 127.0.0.1 et sans fonctions cloud Ollama.
- Mesures réelles : résumé à froid 20,06 s, réécriture chaude 0,60 s, recherche Jetson parmi deux documents 4,65 s. Audio français synthétique de 7,5 s : chargement 0,66 s puis transcription 2,84 s. Vocabulaire technique : amélioration de « Jetson », erreur persistante sur « inférence ». Ce n’est pas une preuve de qualité sur une voix réelle ni de latence mobile de bout en bout.
- Incident d’installation résolu : PyAV 19 a supprimé un argument utilisé par faster-whisper 1.2.1. Version 16.1.0 fixée dans les dépendances, puis transcription réelle répétée et `pip check` réussi.
- Réception événementielle : WebSocket sortant Supabase, notifications sans payload privé, abonnement avant rattrapage, reconnexion et renouvellement de session. Suppression de l’interrogation périodique des demandes ; présence/maintenance restent périodiques et sans appel LLM.
- Migration 005 : registre des dépôts publié par le worker, association par projet, demandes idempotentes, contraintes de session unique, contrôle de version et prérequis, bail renouvelable, annulation, revue humaine. RLS humaine AAL2 ; le compte worker ne lit pas directement notes/tickets ni les tables d’exécution. Publication Realtime limitée aux notifications.
- Agent projet `.codex/agents/atelier-ticket.toml` : examen, plan, réalisation, tests, rapport synthétique et limites. Chargé par le service dans une seule session Codex. Ni équipe automatique ni push/merge implicite.
- Exécuteur local : registre privé, aucun chemin/commande issu du ticket, worktree depuis HEAD commité, environnement sans identifiants de service, permissions de lecture et écriture limitées, réseau des commandes fermé, connecteurs/hooks/sous-agents désactivés. Contrôle réel d’isolation obligatoire avant de proposer Run et avant chaque session.
- Blocage matériel/système constaté : Ubuntu refuse les namespaces de bubblewrap ; précontrôle Codex en échec. Pas de droits administrateur sans intervention utilisateur. Aucun contournement en accès intégral. Correction AppArmor ciblée documentée ; exécution réelle Codex non revendiquée.
- Revue de sécurité séparée : correction du watchdog d’arrêt indépendant des RPC en erreur ; neutralisation des filtres Git `smudge/process/clean`, de la configuration Git externe et du téléchargement implicite avant création du worktree ; maintien de tous les résultats encore à valider même au-delà de l’historique récent ; revérification du bail juste avant lancement ; sérialisation du choix de dépôt avec Run ; validation de la structure du rapport côté SQL.
- Tests ajoutés : vrai worktree et vrai sous-processus simulant Codex, protection de la copie source, filtre Git témoin non exécuté, refus d’un dépôt inconnu, permissions du registre, verrou global, arrêt indépendant de la boucle réseau, annulation pendant préparation, reprise de livraison sans double session, MFA/RLS, annulation/révocation et expiration SQL. Navigateur desktop/mobile : sélection du chemin, Run, avancement poussé par WebSocket simulé, rapport et validation humaine.
- Incidents de test corrigés : trame Realtime simulée incomplète (métadonnées `columns` manquantes) ; guillemets non acceptés autour de `WorkingDirectory` systemd. Les contrôles de service et les parcours navigateur passent après correction.
- Service `atelier-ollama` activé sur ce PC. Service `atelier-worker` et configuration privée préparés mais non démarrés : les quatre paramètres Supabase manquent. Le dépôt Atelier est enregistré localement. Aucun secret ni modèle téléchargé n’est commité.
- Reste à prouver : Supabase réel/TOTP, liaison entre appareils physiques, sandbox corrigé et une vraie tâche Codex. Les tests avec serveur/exécuteur simulés ne remplacent pas ces vérifications. Guide mis à jour avec les étapes précises et les limites.
- Validation locale V1.2 : **94 tests réussis** (43 Vitest, 23 Python, 20 parcours navigateur, 6 parcours connectés avec serveur simulé, 2 PWA de production), TypeScript et build réussis. Revue indépendante des chemins d’exécution et des contrôles SQL ; aucun nouveau blocage certain à l’inspection après corrections. Le précontrôle réseau utilise désormais un témoin loopback contrôlé, sans dépendre d’Internet.

## 1er novembre 2026 — guide personnel simplifié

- À la demande du propriétaire, remplacement de l’entrée du guide par six étapes repliables avec destination, action précise et résultat attendu. Seule la création du projet est ouverte au départ ; les explications techniques restent disponibles dans un bloc séparé.
- Distinction entre site privé (étapes 1–4), connexion PC (5–6), installations déjà faites et essais réels restant à mener avec assistance. Liens directs vers les fichiers SQL, les variables GitHub et le workflow ; correspondance exacte des quatre valeurs privées à remplir.
- Suppression de la modification manuelle du workflow pour activer Supabase : la présence des deux variables désactive déjà la démo. Vérification des libellés de l’application et des sources officielles Supabase/Codex, contrôle des liens locaux et du rendu Markdown. Aucun changement du fonctionnement de l’application.

- Correction après la capture de SQL Editor : création du projet reconnue comme faite, étape 2 ouverte par défaut, premier fichier avec lien texte direct et chemin local absolu, emplacement exact de Run/Results, commandes PC absolues. Ancienne section technique déplacée dans `docs/REFERENCE-PC.md` et suppression de sa procédure Supabase en doublon.

## 1er novembre 2026 — premiers contrôles du projet Supabase réel

- Deux comptes Auth créés et confirmés d’après les fiches transmises. URL et clé publique reçues : réponses HTTP 200 des points d’accès Auth `health` et `settings`. Les inscriptions publiques et les connexions anonymes sont désactivées ; le fournisseur e-mail est actif.
- Requêtes avec la seule clé publique, sans session utilisateur : lecture de `projects`, `notes` et `development_runs` refusée (HTTP 401, code PostgreSQL 42501). Ce contrôle limité ne valide pas encore les droits après connexion, le MFA ni le parcours complet.
- URL, clé publique et adresse du compte PC renseignées dans le fichier privé existant, permissions 0600 vérifiées. Mot de passe inchangé, encore à saisir localement par le propriétaire. Aucune valeur de configuration ajoutée au dépôt.
- Guide corrigé à partir des captures : Connect → Framework → Add files → `.env.local`, copie de la valeur après `=`, correspondance entre les noms `NEXT_PUBLIC_` affichés et les variables `VITE_` attendues dans GitHub. Étape 4 ouverte ; étape 5 réduite à la saisie du mot de passe PC.
- Le connecteur GitHub disponible ne permet pas de créer les variables Actions : leur saisie reste à effectuer depuis les réglages du dépôt, puis la publication doit être relancée. Connexion authentifiée à l’application et au worker encore non vérifiée.

## 1er novembre 2026 — publication Supabase et ancienne démo encore affichée

- Publication manuelle GitHub Actions `41304524452` terminée avec succès. Le JavaScript servi par Pages contient bien l’URL et la clé publique attendues.
- Vérification dans deux contextes Chrome neufs, ordinateur et mobile : écran « BIENVENUE CHEZ VOUS », bouton de connexion personnel, absence d’« ACCÈS TEMPORAIRE », aucune erreur JavaScript. Captures locales `artifacts/live-supabase-login-desktop.png` et `artifacts/live-supabase-login-mobile.png`.
- Le service worker conserve la version active jusqu’à fermeture des onglets qui l’utilisent. Cela explique probablement l’ancienne démo signalée par le propriétaire ; son navigateur personnel n’a pas pu être inspecté. Guide précisé : fermer tous les onglets/PWA, rouvrir l’URL exacte et, si nécessaire, vérifier en navigation privée sans effacer les données.
- Aucun mot de passe demandé ni testé. La réussite d’une connexion personnelle et du MFA reste à confirmer par le propriétaire.

## 1er novembre 2026 — connexion personnelle confirmée et diagnostic PC corrigé

- Le propriétaire confirme sa connexion personnelle et la validation TOTP, puis renseigne le fichier privé du PC. Vérification réelle avec ce fichier, sans afficher ses valeurs : authentification du compte PC, autorisation `worker_heartbeat`, capacités résumé/réécriture/recherche/dictée et abonnement Realtime réussis.
- Diagnostic initial trompeur corrigé : les segments entre guillemets des clés CLI étaient traités comme des clés littérales ou séparés sur les points. Remplacement par des tables TOML complètes pour les chemins, projets et MCP ; table MCP vide, configuration de projet non fiable conservée.
- Un PATH explicite et limité permet au helper Codex de trouver le bubblewrap Ubuntu. Le binaire standalone installé sous `.codex` est copié à l’identique, vérification SHA-256, dans un cache privé hors de ce dossier ; les commandes n’obtiennent aucun accès aux identifiants `.codex`.
- Le contrôle réseau accepte maintenant le refus de création de socket comme un blocage effectif, en plus du refus de connexion. Ajout du contrôle d’un `.env` témoin. Erreurs de diagnostic catégorisées sans recopier la sortie brute ni les valeurs privées ; plus de boucle invitant `doctor` à se relancer lui-même.
- Validation : **29 tests Python réussis**, dont six nouvelles régressions ; diagnostic réel Codex 0.166.0 réussi (écriture autorisée, fichiers privés/`.env` et métadonnées Git protégés, réseau bloqué). Aucun modèle Codex lancé par ces vérifications.
- Différence terminal/service reproduite : les protections de montage d’un service utilisateur systemd 255 déclenchent le profil AppArmor `unprivileged_userns`, qui bloque ici le sandbox imbriqué. Le contrôle direct et une sonde temporaire sans ces montages réussissent ; l’ancien service de production reste arrêté, ses protections ne sont pas retirées.
- Préparation d’un service système exécuté explicitement avec l’UID/GID utilisateur, conservant `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome=read-only` et les chemins d’écriture limités. `AF_NETLINK` nécessaire à bubblewrap vérifié par deux sondes comparatives. Contrôle `doctor` obligatoire avant démarrage. Syntaxe du script de connexion et unité générée vérifiées.
- Reste une action administrateur : `bash /home/mblaret/Documents/kanban/worker/connect_pc.sh`. Le script demande sudo uniquement pour installer/démarrer l’unité ; le worker reste non privilégié. Son premier démarrage dans cette unité, la dictée mobile et une tâche Codex réelle restent à confirmer.
