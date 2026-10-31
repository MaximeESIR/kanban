# Atelier — V1.0

Application personnelle de projets, kanban et notes. Interface React / TypeScript adaptée à l’ordinateur et au téléphone, déployable sur GitHub Pages. Supabase assure l’authentification et le stockage privé. Aucune exécution de code ni aucun agent de développement n’est intégré.

## V1.0 : application installable et assistant PC

- [Brancher Supabase, la double authentification et le PC](docs/CONNEXION-PC.md)
- [Journal de réalisation, incidents et limites de vérification](docs/JOURNAL-V1.md)
- [Comparatif détaillé avec le projet de référence](docs/COMPARATIF-V1.md)

La version en ligne reste une démo tant que Supabase n’est pas configuré. Les boutons IA sont visibles mais désactivés : aucune simulation ne se fait passer pour un résultat de votre PC. Une fois connecté, le service Python réalise les traitements locaux et le navigateur récupère les résultats sans rechargement.

Sur Android, ouvrir le site puis « Installer l’application » (ou le menu Chrome). Sur iPhone, ouvrir avec Safari puis Partager → Sur l’écran d’accueil. La première ouverture en ligne télécharge les fichiers nécessaires au mode hors connexion. Il s’agit d’une PWA, pas d’un binaire distribué sur les stores.

## Version en ligne temporaire

Adresse de l’application : **https://MaximeESIR.github.io/kanban/**.

Connexion temporaire : **`k@k.k` / `k`**. Ces identifiants sont publics : ce mode est une démonstration, pas une authentification sécurisée. Les projets, tickets et notes sont enregistrés dans le navigateur de chaque appareil. Ils ne sont ni partagés entre visiteurs ni synchronisés entre votre ordinateur et votre téléphone. Effacer le stockage du navigateur efface ces données ; utilisez l’export JSON pour les conserver.

Le workflow GitHub Pages active explicitement `VITE_PUBLIC_DEMO=true`. Aucun compte Supabase n’est nécessaire pour cette version. Dès que les deux variables Supabase sont renseignées, la vraie connexion prend le relais et les identifiants temporaires ne fonctionnent plus. Une configuration Supabase partielle ou invalide bloque le build au lieu de revenir au mode démo.

Dans les paramètres du dépôt, choisir **Settings → Pages → Source → GitHub Actions** une seule fois. Chaque envoi sur `main` vérifie et publie ensuite automatiquement l’application. Le PC peut rester éteint : GitHub sert le site.

## Essayer en local

Prérequis : Node.js 22.12 ou supérieur.

```bash
npm ci
npm run dev
```

Ouvrir **http://127.0.0.1:5173/**.

Sans configuration Supabase, une démonstration est disponible sur `localhost`, `127.0.0.1` et `::1` :

| Champ        | Valeur  |
| ------------ | ------- |
| E-mail       | `k@k.k` |
| Mot de passe | `k`     |

Le bouton « Remplir les identifiants » prépare le formulaire. Ces identifiants sont **publics et réservés à la démonstration** : ce n’est pas un vrai compte Supabase. Les données d’exemple sont conservées dans le stockage local du navigateur. La démo ne constitue pas une protection des données, ne synchronise pas les appareils et ne doit pas contenir d’informations personnelles sensibles. « Réinitialiser la démo » efface uniquement les données de démonstration de ce navigateur.

Sur une adresse publique, la démo nécessite `VITE_PUBLIC_DEMO=true` au moment du build (déjà défini dans le workflow de ce dépôt). Sans cette activation explicite et sans Supabase, l’accès reste fermé. Dès qu’un réglage Supabase est présent, la démo est désactivée, même en local.

## Fonctionnalités

- Connexion e-mail / mot de passe, déconnexion, changement de mot de passe et récupération par e-mail.
- Liste des projets, nombre total de tickets par projet, progression, recherche et tri.
- Création, modification et suppression des projets.
- Kanban **To do / In progress / Done**, déplacement par glisser-déposer sur ordinateur et menu de statut utilisable au clavier et sur téléphone.
- Tickets : titre, description, priorité, difficulté et dépendance facultative vers un ticket du même projet. Les cycles sont interdits dans l’interface et dans la base. Une dépendance inachevée est signalée sans empêcher de déplacer le ticket.
- Notes avec recherche et enregistrement automatique après 700 ms d’inactivité. Changer d’écran n’annule pas l’enregistrement. Les erreurs de sauvegarde sont affichées ; la déconnexion attend la sauvegarde des notes.
- Export JSON des projets, tickets et notes avec le bouton de téléchargement. L’import de sauvegardes n’est pas implémenté.
- Actualisation à la reprise de la fenêtre et toutes les 3 secondes. Le bouton d’actualisation récupère immédiatement les changements d’un autre appareil.

## Connecter Supabase

### 1. Créer le projet et les tables

Créer un projet Supabase dédié. Dans **SQL Editor**, exécuter une seule fois le fichier :

`supabase/migrations/001_atelier.sql`

Puis exécuter `supabase/migrations/002_connected_workspace.sql`. Ces migrations créent les projets, tickets, notes, la file PC, la synchronisation et les règles RLS qui imposent désormais le TOTP. Le schéma `private` contient la liste des comptes autorisés ; il ne doit pas être ajouté aux schémas exposés par la Data API.

### 2. Fermer les inscriptions et créer votre compte

Dans les paramètres Supabase Auth :

1. Désactiver **Allow new users to sign up** et laisser la connexion anonyme désactivée.
2. Garder le fournisseur e-mail / mot de passe activé.
3. Dans **Authentication → Users → Add user → Create new user**, créer votre compte avec votre adresse e-mail et un mot de passe aléatoire d’au moins 12 caractères. Pour un compte créé manuellement, confirmer l’adresse via l’option d’administration.
4. Copier l’UUID du compte, puis exécuter le modèle `supabase/authorize-owner.sql` après avoir remplacé `REPLACE_WITH_YOUR_AUTH_USER_UUID`.

Un utilisateur authentifié mais absent de cette liste ne peut accéder à aucune donnée, même si l’inscription publique a été activée par erreur. Chaque compte autorisé reste isolé des autres par son identifiant. Ne placer aucun mot de passe réel dans le code, dans le dépôt ou dans les variables `VITE_*`.

Pour retirer l’accès à un compte, depuis le SQL Editor :

```sql
delete from private.atelier_owners where user_id = 'UUID_DU_COMPTE';
```

Le retrait prend effet sur les requêtes de données, même si une session Auth reste valide. Il ne supprime pas les projets du compte.

### 3. Configurer le navigateur

Copier `.env.example` vers `.env.local`, puis renseigner :

```dotenv
VITE_SUPABASE_URL=https://VOTRE_PROJET.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_VOTRE_CLE_PUBLIQUE
```

La clé se trouve dans les paramètres API du projet Supabase. Une ancienne clé publique `anon` est également acceptée. **Ne jamais utiliser une clé `service_role` ou `sb_secret_*`** : la configuration les refuse avant la génération du site. Toute variable `VITE_*` est visible dans les fichiers publics générés.

Redémarrer `npm run dev`. Le formulaire se connectera alors au vrai compte, et les données seront stockées dans Supabase. Les données de démonstration ne sont pas transférées automatiquement. Exportez-les avant le passage à Supabase. Retirez aussi `VITE_PUBLIC_DEMO` du workflow ou passez-le à `false` pour empêcher toute réactivation ultérieure de la démo si les variables Supabase sont supprimées.

### 4. Configurer la récupération du mot de passe

Dans **Authentication → URL Configuration** :

- `Site URL` : l’adresse finale de votre application, par exemple `https://UTILISATEUR.github.io/kanban/`.
- `Redirect URLs` : ajouter exactement `https://UTILISATEUR.github.io/kanban/?recovery=1` et, pour le développement, `http://127.0.0.1:5173/?recovery=1`.

Configurer un fournisseur SMTP si nécessaire pour que les messages Auth puissent atteindre votre adresse ; vérifier la délivrabilité dans Supabase avant de compter sur la récupération par e-mail. Le flux PKCE exige d’ouvrir le lien dans le même navigateur que celui ayant demandé la récupération. L’icône de clé dans l’application permet aussi de changer le mot de passe lorsque vous êtes connecté.

## Publier gratuitement l’interface sur GitHub Pages

Le workflow `.github/workflows/deploy.yml` est prêt. GitHub Pages héberge l’interface ; Supabase et les éventuels services d’envoi d’e-mails ont leurs propres offres et limites.

1. Créer un dépôt GitHub (public pour GitHub Pages avec GitHub Free), puis y envoyer ce dossier sur la branche `main`. Le nom `kanban` convient. Ne pas envoyer `.env.local`, `node_modules`, `artifacts` ou des exports de données privées.
2. Dans **Settings → Secrets and variables → Actions → Variables**, créer les deux variables publiques `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Dans **Settings → Pages → Build and deployment**, choisir **GitHub Actions**.
4. Lancer le workflow ou pousser un commit sur `main`.
5. Utiliser l’adresse fournie par le job de déploiement et la renseigner dans Supabase Auth. Activer **Enforce HTTPS** dans les paramètres Pages.

Le workflow exécute les tests puis vérifie soit la configuration Supabase, soit l’activation explicite du mode démo, avant de publier. Les chemins des ressources sont relatifs ; l’application fonctionne à la racine ou dans un sous-dossier GitHub Pages. La navigation utilise des paramètres d’URL, ce qui permet de recharger directement un projet sans règle de réécriture serveur.

Le dépôt et les fichiers HTML/JS peuvent être publics : les mots de passe sont gérés par Supabase Auth et les données par les règles RLS. Une simple page de connexion n’est pas le mécanisme de protection de la base.

## Vérification

```bash
npm test          # logique métier, configuration publique et sécurité PostgreSQL
npm run build    # vérification TypeScript et génération de dist/
npm run test:e2e  # parcours Chrome sur ordinateur et mobile
npm run test:worker # service Python et moteurs simulés
VITE_PUBLIC_DEMO=true npm run build
npx playwright test -c playwright.production.config.ts # PWA, réouverture hors ligne
npx playwright test -c playwright.connected.config.ts # protocole UI/PC avec serveur simulé
```

Les tests navigateur utilisent `/usr/bin/google-chrome` s’il existe. Sinon, installer le navigateur de test avec `npx playwright install chromium`, ou définir `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Les captures et traces restent dans `artifacts/` (ignoré par Git).

Les tests SQL appliquent la véritable migration à **PGlite**, un moteur PostgreSQL local, avec une simulation minimale des rôles Auth Supabase. Ils vérifient les accès anonymes, les comptes non autorisés, l’isolation entre propriétaires, l’usurpation d’identité, la révocation, les contraintes et les suppressions en cascade. Ils ne remplacent pas un test de bout en bout avec votre projet Supabase réel et ses paramètres d’authentification.

La session réelle est conservée dans le navigateur par Supabase. Utiliser la déconnexion sur un appareil partagé. Les notes en cours d’écriture restent en mémoire jusqu’à leur sauvegarde ; en cas de coupure réseau, attendre « Enregistrée » avant de fermer l’onglet. Les modifications connectées passent par une file IndexedDB persistante. En cas de conflit de révision, la version distante est conservée et la version locale reste dans « Sauvegarde complète » ; aucune fusion automatique n’est tentée.

## Structure

```text
src/
  App.tsx                  session, navigation, données et sauvegarde des notes
  components/              connexion, projets, kanban, notes et formulaires
  domain.ts                modèles et règles métier
  config.ts                validation des seules clés publiques
  lib/repository.ts        accès Supabase et démonstration locale
  styles.css               interface responsive
supabase/                  migration, RLS et autorisation du propriétaire
tests/                     tests métier et sécurité de la base
e2e/                       parcours navigateur
.github/workflows/        publication GitHub Pages
```

Références : [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Supabase Auth](https://supabase.com/docs/guides/auth/passwords), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [déploiement Vite](https://vite.dev/guide/static-deploy).
