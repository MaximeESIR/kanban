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
