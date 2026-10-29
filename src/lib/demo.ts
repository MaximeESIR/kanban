import type { Data } from '../domain'

export const DEMO_EMAIL = 'k@k.k'
export const DEMO_PASSWORD = 'k'
export const DEMO_OWNER = '00000000-0000-4000-8000-000000000001'
export const DEMO_STORAGE = 'atelier.demo.v1'
export const DEMO_SESSION = 'atelier.demo.session'

export function demoData(): Data {
  const now = new Date().toISOString()
  const website = crypto.randomUUID(),
    app = crypto.randomUUID(),
    ideas = crypto.randomUUID()
  const first = crypto.randomUUID(),
    second = crypto.randomUUID()
  const stamp = { owner_id: DEMO_OWNER, created_at: now, updated_at: now }
  return {
    projects: [
      {
        ...stamp,
        id: website,
        name: 'Site personnel',
        description: 'Un endroit à moi pour partager ce que je crée.',
        color: 'sage',
      },
      {
        ...stamp,
        id: app,
        name: 'Mon application',
        description: 'Les petites idées qui deviennent de vrais outils.',
        color: 'purple',
      },
      {
        ...stamp,
        id: ideas,
        name: 'Terrain de jeu',
        description: 'Expérimenter, apprendre et prendre le temps.',
        color: 'peach',
      },
    ],
    tickets: [
      {
        ...stamp,
        id: first,
        project_id: website,
        number: 1,
        title: 'Dessiner la page d’accueil',
        description:
          'Une page simple, avec une présentation courte et une sélection de projets.\n\nÀ prévoir :\n• Une introduction personnelle\n• Trois projets à découvrir\n• Un moyen de me contacter',
        priority: 'high',
        difficulty: 'medium',
        status: 'in_progress',
        depends_on_id: null,
      },
      {
        ...stamp,
        id: second,
        project_id: website,
        number: 2,
        title: 'Choisir les couleurs et la typographie',
        description: 'Privilégier des couleurs douces et une typographie agréable à lire.',
        priority: 'medium',
        difficulty: 'easy',
        status: 'done',
        depends_on_id: null,
      },
      {
        ...stamp,
        id: crypto.randomUUID(),
        project_id: website,
        number: 3,
        title: 'Adapter la navigation au mobile',
        description: 'Vérifier que chaque page reste facile à parcourir sur un petit écran.',
        priority: 'high',
        difficulty: 'medium',
        status: 'todo',
        depends_on_id: first,
      },
      {
        ...stamp,
        id: crypto.randomUUID(),
        project_id: website,
        number: 4,
        title: 'Rédiger la page À propos',
        description: 'Quelques mots sur mon parcours, mes envies et ce que j’aime construire.',
        priority: 'low',
        difficulty: 'easy',
        status: 'todo',
        depends_on_id: null,
      },
      {
        ...stamp,
        id: crypto.randomUUID(),
        project_id: website,
        number: 5,
        title: 'Préparer les visuels des projets',
        description: '',
        priority: 'medium',
        difficulty: 'medium',
        status: 'todo',
        depends_on_id: null,
      },
      {
        ...stamp,
        id: crypto.randomUUID(),
        project_id: app,
        number: 6,
        title: 'Poser les premières idées',
        description: 'Définir le problème que cette application doit résoudre.',
        priority: 'medium',
        difficulty: 'easy',
        status: 'todo',
        depends_on_id: null,
      },
      {
        ...stamp,
        id: crypto.randomUUID(),
        project_id: app,
        number: 7,
        title: 'Créer la structure du projet',
        description: '',
        priority: 'medium',
        difficulty: 'medium',
        status: 'done',
        depends_on_id: null,
      },
    ],
    notes: [
      {
        ...stamp,
        id: crypto.randomUUID(),
        title: 'Un peu de place pour les idées',
        content:
          'Un détail à ne pas oublier. Une idée pour plus tard. Le début d’un projet.\n\nCet espace est là pour tout ce qui vous passe par la tête. Les notes s’enregistrent automatiquement pendant que vous écrivez.\n\nQuelques pistes\n\n— Garder les choses simples.\n— Avancer un ticket à la fois.\n— Laisser de la place à l’imprévu.\n\nBienvenue dans votre atelier.',
      },
      {
        ...stamp,
        id: crypto.randomUUID(),
        title: 'À explorer cette semaine',
        content: 'Une nouvelle idée de projet\nUne lecture à terminer\nUn petit outil à fabriquer',
      },
    ],
  }
}
