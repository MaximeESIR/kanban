# Brancher Atelier V1.0

## Ce qui reste à faire côté propriétaire

1. Créer un projet Supabase dédié, dans la région choisie. Exécuter `001_atelier.sql`, puis `002_connected_workspace.sql` dans SQL Editor (une fois chacune).
2. Désactiver les inscriptions publiques et l’authentification anonyme. Créer votre compte humain e-mail/mot de passe depuis Auth, confirmer son adresse, puis exécuter `supabase/authorize-owner.sql` avec son UUID.
3. Créer un SECOND compte Auth pour le PC avec un mot de passe aléatoire long et unique. Exécuter `supabase/authorize-worker.sql` avec les deux UUID. **Ne jamais ajouter le compte PC à la liste des propriétaires.** Les identifiants PC doivent rester hors du navigateur et du dépôt.
4. Dans les variables GitHub Actions du dépôt, renseigner `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. Mettre `VITE_PUBLIC_DEMO` à `false` dans le workflow. Les variables Supabase désactivent déjà la démo automatiquement. Relancer la publication.
5. Renseigner l’URL finale et l’URL de récupération dans Supabase Auth comme indiqué au README. Configurer et tester les e-mails de récupération si utilisés. Protéger aussi les comptes administrateurs GitHub/Supabase par 2FA.
6. Se connecter à Atelier : l’écran impose l’association d’une application TOTP et la vérification d’un code avant d’ouvrir l’espace. Conserver une sauvegarde de l’application TOTP. Pour une perte de facteur, intervenir depuis l’administration Supabase après vérification de l’identité ; ne pas désactiver la RLS.

La migration 002 rend la double authentification obligatoire. Les anciennes sessions non vérifiées ne peuvent plus lire les tables même en appelant directement l’API.

## Moteurs sur le PC

Aucun compte Groq, OpenAI ou autre fournisseur IA n’est nécessaire. Un modèle local doit néanmoins être installé :

- Installer Ollama depuis sa source officielle, télécharger un modèle adapté à la RAM/VRAM du PC, puis vérifier qu’il répond localement. Utiliser `ollama list` pour récupérer son nom exact (avec son tag).
- Garder Ollama sur `127.0.0.1:11434`. Activer `OLLAMA_NO_CLOUD=1` pour rester exclusivement local. Ne pas exposer son port sur Internet.
- Installer Python 3.11 ou supérieur. Depuis le dépôt : `python3 -m venv worker/.venv`, puis `worker/.venv/bin/pip install faster-whisper` si la dictée est souhaitée. Le worker texte n’a aucune dépendance Python externe.
- Télécharger explicitement un modèle au format CTranslate2 compatible faster-whisper depuis une source de confiance. Donner son chemin absolu dans `ATELIER_WHISPER_MODEL`. Le worker utilise `local_files_only=True` : une demande web ne peut pas déclencher de téléchargement.
- Les variables `ATELIER_WHISPER_DEVICE` et `ATELIER_WHISPER_COMPUTE` permettent CPU/int8 par défaut ou une configuration GPU compatible. Tester une courte dictée avant un usage prolongé.

## Configuration privée du service

Créer `~/.config/atelier/worker.env` à partir de `worker/.env.example`, remplir les valeurs, et limiter les permissions du fichier à votre utilisateur (`chmod 600`). Les valeurs contenant des caractères spéciaux doivent être correctement citées selon le mécanisme de chargement choisi.

Pour un lancement manuel sous Bash, utiliser un fichier de confiance au format shell :

```bash
set -a
source ~/.config/atelier/worker.env
set +a
worker/.venv/bin/python worker/atelier_worker.py
```

Pour Linux/systemd, adapter les chemins de `worker/atelier-worker.service`, puis copier le fichier dans `~/.config/systemd/user/` et lancer :

```bash
systemctl --user daemon-reload
systemctl --user enable --now atelier-worker.service
journalctl --user -u atelier-worker.service
```

Sur Windows/macOS, le même script Python peut être lancé au démarrage avec le planificateur de l’OS. Aucun service permanent n’est installé automatiquement par le dépôt.

Le PC ne reçoit aucune connexion entrante : il interroge Supabase en HTTPS. Le navigateur interroge la présence et les résultats toutes les trois secondes. Un PC peut être visible sans offrir la dictée si Whisper n’est pas prêt. Les boutons correspondants restent alors désactivés.

## Protocole et limites

- Opérations autorisées : `summarize`, `rewrite`, `transcribe`, `search`. Toute autre opération est refusée. Aucun accès terminal, Git, Codex ou Vibe n’est activé.
- Présence : moins de 45 secondes ; maximum cinq demandes en attente et 60 par heure et par propriétaire.
- Dictée : 90 secondes et 4 Mo maximum. L’audio transite temporairement par Supabase ; il ne reste pas exclusivement sur les appareils. TLS protège le transport, ce n’est pas du chiffrement de bout en bout.
- Un traitement est limité à quatre minutes côté PC et son bail à cinq minutes côté serveur. Il n’est pas relancé automatiquement après un incident. Une annulation empêche l’utilisation du résultat ; le calcul local déjà lancé peut terminer avant d’être abandonné.
- Recherche : 200 documents maximum, 150 000 caractères JSON de contexte ; documents longs limités à 12 000 caractères par l’interface. Le modèle classe les sources fournies, sans index vectoriel persistant. Au-delà, prévoir une indexation locale par embeddings ; aucun fallback cloud implicite.
- Les contenus des résultats et des documents ne sont jamais exécutés. Les identifiants de sources retournés sont filtrés, mais les justifications restent celles d’un modèle et doivent être vérifiées.
- Retrait d’accès au PC : `update private.workers set enabled=false where user_id='UUID';`. Les nouvelles prises de travaux et livraisons sont refusées immédiatement. Changer aussi son mot de passe si compromis.
- Les données hors ligne sont stockées dans le navigateur de chaque appareil, sans chiffrement applicatif. Protéger l’appareil par verrouillage/chiffrement système. La déconnexion efface le cache privé après synchronisation ; un administrateur ne peut pas effacer à distance une copie déjà téléchargée.

## Origine web et protection des appareils

Tous les sites `MaximeESIR.github.io/...` partagent la même origine navigateur. Un script compromis sur un autre site du même domaine pourrait accéder aux stockages et à la session. Pour une isolation forte, réserver un sous-domaine dédié à Atelier et le configurer dans GitHub Pages et Supabase Auth. Un dépôt privé ne corrige pas ce problème d’origine. Ne pas héberger de scripts non fiables sur la même origine.

## Validation réelle avant utilisation

1. Connexion humaine avec mot de passe seul : données interdites ; avec TOTP : données accessibles.
2. Compte PC : appels directs aux tables privés refusés, RPC worker autorisées uniquement après association.
3. Modifier une note sur téléphone et vérifier son apparition sur PC sans rechargement ; inverser les appareils.
4. Modifier hors ligne, rouvrir l’application, reconnecter ; vérifier les données et le compteur de synchronisation.
5. Modifier simultanément la même note sur deux appareils : la version distante doit rester intacte et la copie locale être présente dans « Sauvegarde complète ». Le bouton « Récupérer les conflits en notes » crée des copies distinctes pour les comparer et les fusionner.
6. Éteindre le service PC : boutons IA désactivés après expiration de présence. Le relancer : disponibilité visible.
7. Tester résumé, annulation, modification pendant traitement et dictée ; vérifier les résultats dans l’autre appareil.

## Future intégration des agents de développement

Prévoir un service séparé et une autorisation explicite par projet/repository pour les travaux Codex/Vibe. Il consommera des demandes structurées avec identifiant de ticket, révision attendue, dépôt autorisé et branche de travail. Avancement, traces et liens de PR reviendront comme résultats. Aucun nom de commande ni chemin arbitraire soumis par le navigateur ne devra devenir une commande shell. La file présente peut inspirer ce protocole mais n’autorise pas l’exécution de code : l’adaptateur de développement reste à réaliser séparément.
